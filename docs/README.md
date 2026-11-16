# Travelogue Documentation

## Project guides

- [Features and technical overview](./FEATURES-AND-TECHNICAL-OVERVIEW.md): feature inventory, technology choices, OCR implementation status, architecture, security model, and production gaps.
- [Step-by-step testing guide](./STEP-BY-STEP-TESTING-GUIDE.md): local setup, end-to-end manual checks, sharing tests, responsive checks, and build validation.
- [API and feature test plan](./API-AND-FEATURE-TEST-PLAN.md): every backend endpoint, example curl requests, authorization tests, feature coverage, and pre-release checks.
- [Presentation guide and FAQ](./PRESENTATION-GUIDE-AND-FAQ.md): suggested demo flow, management narrative, and detailed likely questions and answers.

## Reference specifications

This checkout's earlier README referenced `prototype.html` and `technical-design.html`, but neither file is present. The implementation therefore follows the existing frontend and backend code; the missing specifications should be restored before treating UI details or production architecture as fully verified.

## Application

- `../frontend/`: responsive Next.js application. Authentication, bill capture/upload, OCR review, bill filtering and details, views, categories, and sharing use the API.
- `../backend/`: NestJS API with Prisma/SQLite persistence, JWT authentication, encrypted bill fields and files, local PaddleOCR for images and rendered PDF pages, views/categories, and read-only expiring shares.
- `../backend/prisma/`: Prisma schema and migrations.

## Local development

Use Node.js 22.13 or newer and Python 3.9 or newer. Configure the backend environment with `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, and `OTP_SECRET`. `ENCRYPTION_KEY` should be a 32-byte key. `FRONTEND_ORIGINS` can contain a comma-separated list of allowed frontend origins. `NEXT_PUBLIC_API_BASE` can override the frontend API URL; it defaults to `http://localhost:4000/api`.

Install the local PaddleOCR CPU runtime once from `backend/`:

```sh
python3 -m venv .venv-ocr
.venv-ocr/bin/python -m pip install -r src/ocr/requirements.txt
npm install
npx prisma migrate deploy
npm run start:dev
```

On Windows, use `.venv-ocr\Scripts\python.exe` instead of `.venv-ocr/bin/python`. Set `PADDLE_OCR_PYTHON` if the Python environment is in a different location. The first OCR run downloads the open-source models into the local `.paddlex/` cache.

Run the frontend from `frontend/`:

```sh
npm run dev
```

The local development OTP is `123456`; the API states explicitly that no email or WhatsApp message was sent. Production email/WhatsApp delivery is not implemented; OTP requests deliberately return an error in production instead of claiming a code was sent.

OCR uses PaddleOCR PP-OCRv5 locally. A text-region detector filters out images without a document-like text layout before recognition; recognized text is then checked for receipt-specific transaction details before the upload is stored. PDF pages are rendered locally with PDF.js and `@napi-rs/canvas`. Common receipt fields are estimated with text-pattern rules; all detected values are marked uncertain and require review. No bill image is sent to a cloud OCR API.

Local authentication displays the fixed development OTP in the application response; no email or WhatsApp message is sent. This behavior is for local development only. Configure real email and WhatsApp Business delivery providers, sender identities, and approved templates before production deployment.
