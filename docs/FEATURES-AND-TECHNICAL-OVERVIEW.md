# Travelogue: Features and Technical Overview

## Purpose and scope

Travelogue is a responsive expense and bill management web application. It helps a user capture bills, review their details, organize expenses, and share selected bills or collections with another user.

This guide describes the application currently present in this repository. The previously referenced `prototype.html` and `technical-design.html` files are not included in this checkout, so this is an implementation-based overview, not a claim that every screen matches those missing specifications.

## Feature inventory

| Feature | What it does | Implementation status |
|---|---|---|
| Sign up and sign in | Passwordless flow using an email address or WhatsApp number and a one-time code. A user profile and default views are created as needed. | Functional for local development. The UI distinguishes email from WhatsApp numbers. Local mode does not send a message; production delivery is not configured. |
| Session restoration | Keeps the JWT and basic user profile in browser local storage and restores the session on reload. | Functional. |
| Log out | Clears the local JWT/profile and in-memory bill/share data, then returns to sign in. | Available from the profile menu in the header. |
| Dashboard and navigation | Provides the signed-in starting point and navigation among capture, bills, views, categories, and sharing workflows. | Implemented in the existing responsive frontend. |
| Bill capture | Provides the bill capture/upload workflow, including image selection and browser camera support where available. | Scan opens a camera-first screen with a live preview when browser permissions/device support allow it; a device-camera picker and file-upload fallback remain available. |
| Bill upload | Accepts image files and PDFs up to 10 MB and records the MIME type. | Functional; uploads are encrypted before being written to local disk. |
| OCR processing workflow | Validates uploaded bills before storage, then extracts fields for review and confirmation. | Uses local PaddleOCR text detection and recognition for images and rendered PDF pages. It does not call an external OCR API. |
| OCR review and correction | Estimates merchant, date, invoice number, total, tax, currency, and payment details from recognized text. The user can correct values before saving. | Best-effort rule-based parsing. Detected values are marked uncertain and require human review; no accuracy benchmark is available. |
| Bill list and search | Lists saved bills and supports merchant/invoice search plus view, category, and date filters. | Functional. Search over merchant and invoice number is performed after decrypting the user’s bill records. |
| Bill details and file retrieval | Shows saved bill details and retrieves the original encrypted image or PDF through an authenticated API request. | Functional for the owner and applicable incoming shares; file errors are displayed instead of substituting a generated receipt image. |
| Views | Groups bills into named collections such as a trip, work event, or personal expenses. Supports creating views and assigning/moving bills. | Functional and persisted in SQLite. |
| Categories and subcategories | Organizes expenses by type, with support for categories and subcategory choices. | Functional and persisted through the categories API. |
| Personal expense marker | Marks a bill as personal during the review/save workflow. | Persisted with the bill. |
| Bill sharing | Grants read-only access to a bill or view for a recipient identified by email or phone. Expiry choices include 7, 30, 90 days, or never. Owners can see and revoke outgoing shares. | Opens in a centered modal from bill and view share actions. The recipient selector reuses contacts from existing shares or lets the user enter a new contact; this build has no company contact directory or recipient display-name data. No email/WhatsApp notification is sent; this is not an anonymous public-link feature. |
| Incoming shares | Shows active bills/views shared with the signed-in user and their owner. | Functional when the share recipient contact matches the signed-in user. |
| Responsive UI and theme | Existing interface adapts to mobile, tablet, and desktop sizes and has light/dark theme state. | Mobile bill filters are implemented as one-at-a-time bottom sheets. Authenticated interaction and layout still need manual verification at the target breakpoints in the testing guide. |

The header uses the app mark without the redundant “Expense Manager” text. The back control is compact, and logout is available from the profile menu.

## What OCR means in this build

**OCR is processed locally using open-source components, not a hosted API.** The backend uses PaddleOCR PP-OCRv5 with an English recognition model and text detector. For PDFs, PDF.js renders up to 10 pages with `@napi-rs/canvas`. The 10-page limit protects the local processing path.

The local OCR implementation:

1. The frontend submits the file to the authenticated bill upload endpoint.
2. The backend runs PaddleOCR text detection locally. Images/pages without a sufficiently distributed text layout are rejected before text recognition.
3. Only document-like candidates proceed to PaddleOCR text recognition. A text-pattern check then requires receipt details such as a total plus bill-specific signals. This is a heuristic, not a trained bill classifier; text-heavy screenshots may undergo recognition before being rejected.
4. The backend extracts common fields, then encrypts and stores the accepted upload and creates a bill record with `READY_FOR_REVIEW` status. Invalid uploads are rejected before file storage or bill record creation.
5. Non-empty candidates are marked `uncertain`; absent values are `missing`. The existing frontend review flow lets users edit values. Categories are selected by the user; this build does not use OCR to classify expense categories.
6. Confirmation persists the approved values and marks the bill `VERIFIED` when merchant, total, and date are present; otherwise it is marked `NEEDS_REVIEW`.

This is a local OCR baseline, not a claim of production-grade extraction accuracy. It currently recognizes English only; date/amount parsing uses heuristics and must be evaluated on representative receipts. OCR runs sequentially in the API process and depends on a local Python/PaddleOCR installation and downloaded model files. No receipt image is sent to an OCR vendor.

### Why PaddleOCR for this MVP?

PaddleOCR is an open-source, Apache 2.0 local OCR toolkit with separate text-detection and recognition stages. The text detector can screen images for document-like text layout before recognition, and PP-OCRv5 provides an English recognition model without a hosted OCR API or per-page fees. This is a compatibility and local-processing choice, not a claim of measured superiority; accuracy must be benchmarked on representative receipts.

## Application architecture

### Frontend

- **Framework:** Next.js 15, React 19, and TypeScript 5.
- **Main UI:** `frontend/src/app/page.tsx`, with styles in `frontend/src/app/globals.css`.
- **API client:** `frontend/src/lib/api.ts`.
- Calls the backend at `http://localhost:4000/api` by default; `NEXT_PUBLIC_API_BASE` can override this.
- Sends JWT bearer tokens from browser local storage and uses multipart form data for bill uploads.
- The UI polls extraction status and uses authenticated blob requests for bill files.

### Backend

- **Framework:** NestJS 10 with TypeScript.
- **Runtime requirement:** Node.js 22.13+ (PDF.js 6 requires a modern Node runtime).
- **Persistence:** Prisma 6 and SQLite.
- **API prefix:** `/api`; local default port is 4000.
- **Modules:** authentication, bills, OCR, views/categories, sharing, encryption, storage, and Prisma.
- **Validation:** NestJS `ValidationPipe` with transformation and a whitelist; upload endpoint accepts image MIME types and PDFs, with a 10 MB limit.
- **Authorization:** JWT guard protects user-specific bill, view, category, and share routes. Services check ownership before modifying or retrieving protected data.

### Data and storage

The Prisma schema contains `User`, `OtpCode`, `View`, `Category`, `Bill`, and `Share` models. SQLite stores records; uploaded files are stored under `backend/uploads/` as encrypted files. The repository includes database migrations, including one that adds MIME type to bills.

### Authentication flow

1. The client requests an OTP for a normalized email/phone contact.
2. The sign-in UI requires the user to choose email or WhatsApp. For an Indian WhatsApp number, it accepts a ten-digit number or a number with `+91`.
3. In local development, the API returns a message saying no message was sent and displays the fixed development code `123456`. The OTP hash is persisted with a five-minute expiry and a maximum of five failed verification attempts. OTP requests are limited to five per contact in a ten-minute window.
4. The client verifies the code. The backend checks the latest unexpired code, limits failed attempts, and issues a JWT.
5. The client stores the token and profile in local storage and sends the token in the `Authorization: Bearer ...` header.

Production OTP delivery is not implemented. In production mode, requesting an OTP returns an explicit service-unavailable error; no email or WhatsApp is sent. A verified email sender and WhatsApp Business messaging provider/template are still required.

### Encryption and access control

- Bill fields for merchant, invoice number, total, tax, and payment details are encrypted using Node.js `crypto` with **AES-256-GCM** and a fresh 12-byte IV for each encrypted value. The authentication tag is stored with the ciphertext.
- Uploaded file contents are encrypted using AES-256-GCM. The stored file format is IV + authentication tag + ciphertext, with an opaque UUID-based filename.
- The original file’s SHA-256 hash is retained and checked after decryption to detect file-integrity mismatches.
- The `ENCRYPTION_KEY` environment variable is required in production. The development fallback key is for local demonstration only and must never be treated as a production secret.
- Some non-field metadata remains plaintext in SQLite, including date, currency, category, subcategory, status, MIME type, and view association. Search decrypts the owner’s bill fields and filters them in application memory.
- Sharing is read-only and expires when configured. Revocation deletes the share record. A share does not bypass login or ownership checks for unrelated records.

## API surface

All routes are under `/api`. Except for OTP send/verify, endpoints require a valid JWT.

| Method and route | Purpose |
|---|---|
| `POST /auth/otp/send` | Request a development OTP for an email/phone contact. |
| `POST /auth/otp/verify` | Verify OTP and receive a JWT plus user profile. |
| `GET /auth/me` | Return the authenticated user profile. |
| `POST /bills/upload` | Upload an image/PDF and begin processing. |
| `GET /bills/:id/extraction` | Read bill processing status and extraction fields. |
| `POST /bills/:id/confirm` | Save reviewed bill fields and organization choices. |
| `GET /bills` | List/search/filter the user’s bills. |
| `GET /bills/:id/file` | Retrieve an authorized bill file. |
| `POST /bills/:id/move` | Move a bill to a view. |
| `GET /views`, `POST /views` | List and create views. |
| `POST /views/:id/bills` | Add selected bills to a view. |
| `GET /categories`, `POST /categories` | List and create categories. |
| `GET /shares/outgoing`, `GET /shares/incoming` | List outgoing and incoming shares. |
| `POST /shares` | Share a bill or view with a recipient and optional expiry. |
| `DELETE /shares/:id` | Revoke an outgoing share. |

## Dependencies and integrations

| Area | Current technology |
|---|---|
| Frontend | Next.js, React, TypeScript |
| Backend | NestJS, TypeScript, Express platform adapter |
| Database access | Prisma ORM |
| Local database | SQLite |
| Authentication | NestJS JWT and Passport JWT |
| Validation | `class-validator`, `class-transformer`, NestJS validation pipe |
| Encryption and hashing | Node.js built-in `crypto`; AES-256-GCM, HMAC-SHA-256 for OTP hashes, SHA-256 for file integrity |
| File upload | NestJS `FileInterceptor` / Multer integration |
| OCR | PaddleOCR 3.7 / PaddlePaddle 3.2.2, PP-OCRv5 detector and English recognizer; PDF.js 6 and `@napi-rs/canvas` for PDF page rendering |
| Email/WhatsApp OTP | Not integrated; local mode displays a development code without sending a message |

## Important limitations and follow-up work

1. Restore `docs/prototype.html` and `docs/technical-design.html` to verify exact design and architecture requirements.
2. Integrate transactional email and WhatsApp Business OTP delivery, including verified sender identities, approved templates, consent, retry/rate limits, delivery monitoring, and account recovery.
3. Evaluate local OCR field extraction on a representative, consented receipt dataset; support additional languages and improve layout/field parsing as required.
4. Move OCR into a bounded job worker/queue for deployment; set resource/time limits and monitor OCR failures and latency.
5. Decide deployment-grade database and file storage, backups, retention, key management/rotation, and operational monitoring.
6. Review browser-local-storage JWTs, metadata exposure, upload content validation, and the deployment threat model before production.
7. Add automated backend and frontend tests. The backend `npm test` command is currently a placeholder, not a passing test suite.
8. Confirm whether additional capabilities such as expense approval, reimbursement, exports, or administrative reporting are in scope; they are not described as implemented features in this repository.

## Key source files

- Frontend screen and workflows: [`../frontend/src/app/page.tsx`](../frontend/src/app/page.tsx)
- Frontend API client: [`../frontend/src/lib/api.ts`](../frontend/src/lib/api.ts)
- Upload and bill API: [`../backend/src/bills/bills.controller.ts`](../backend/src/bills/bills.controller.ts)
- Bill workflow: [`../backend/src/bills/bills.service.ts`](../backend/src/bills/bills.service.ts)
- Local OCR: [`../backend/src/ocr/ocr.service.ts`](../backend/src/ocr/ocr.service.ts)
- Authentication: [`../backend/src/auth/auth.service.ts`](../backend/src/auth/auth.service.ts)
- Encryption: [`../backend/src/crypto/crypto.service.ts`](../backend/src/crypto/crypto.service.ts)
- Encrypted local storage: [`../backend/src/storage/storage.service.ts`](../backend/src/storage/storage.service.ts)
- Share lifecycle: [`../backend/src/shares/shares.service.ts`](../backend/src/shares/shares.service.ts)
- Database schema: [`../backend/prisma/schema.prisma`](../backend/prisma/schema.prisma)
