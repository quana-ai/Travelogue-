# Travelogue: Setup and Step-by-Step Testing

This guide is for running and manually demonstrating the current local-development build. It does not describe a production deployment.

For endpoint-by-endpoint API checks, example `curl` commands, authorization cases, and broader release testing, use the [API and feature test plan](./API-AND-FEATURE-TEST-PLAN.md).

## Clone the repository first

Use the plain clone URL below. Do not copy Markdown link punctuation such as square brackets, parentheses, or a trailing quote as part of the URL:

```sh
git clone https://github.com/quana-ai/Travelogue-.git
cd Travelogue-
```

If GitHub reports **Repository not found**, first check that the URL is exactly `https://github.com/quana-ai/Travelogue-.git`. If the repository is private, the repository owner or organization admin must invite your GitHub account as a collaborator or add it to a team with repository access. Sign in to GitHub in your Git credential manager or use the approved organization authentication method, then retry. Do not put a personal access token in the clone URL or share it in chat.

## 1. Prerequisites

- Node.js 22.13 or newer and npm installed.
- Python 3.9 or newer available as `python3` (or configure `PADDLE_OCR_PYTHON` to its executable).
- Git installed and a terminal opened at the cloned repository root.
- Dependencies installed in both `frontend/` and `backend/` if this is a fresh checkout.
- The backend environment configured before starting the API.

The repository does not include a committed `.env.example`. Do not share or commit `.env` values. If an existing `backend/.env` is present, keep its database URL and secrets intact; back up the local database before running migrations against it.

## 2. Configure and migrate the backend

From the repository root:

```sh
cd backend
npm install
```

Configure these values in `backend/.env`:

```dotenv
DATABASE_URL="file:./dev.db"
JWT_SECRET="<a unique local development secret>"
ENCRYPTION_KEY="<exactly 32 bytes for local development>"
OTP_SECRET="<a separate local OTP hashing secret>"
FRONTEND_ORIGINS="http://localhost:3000,http://127.0.0.1:3000"
```

Use local-only secrets and keep this file private. The encryption key must remain the same for as long as encrypted data needs to be read. Changing it makes existing encrypted fields and files undecryptable. Production requires secure secret/key management and production OTP delivery is not implemented.

Install the local PaddleOCR runtime from the `backend/` directory. A virtual environment is recommended:

```sh
python3 -m venv .venv-ocr
source .venv-ocr/bin/activate
python -m pip install -r src/ocr/requirements.txt
```

Keep the virtual environment active in the terminal used to start the backend, or set `PADDLE_OCR_PYTHON` to its Python executable. The first OCR request downloads the PP-OCRv6_medium model files and can take longer; subsequent requests use the local cache. No cloud OCR API is called.

Apply migrations and start the API:

```sh
npx prisma migrate deploy
npm run start:dev
```

Expected: NestJS reports that the API is listening at `http://localhost:4000/api`. Keep this terminal open.

## 3. Start the frontend

Open a second terminal at the repository root:

```sh
cd frontend
npm install
npm run dev
```

Expected: Next.js serves the app at `http://localhost:3000`. If the API is not at its default address, configure `NEXT_PUBLIC_API_BASE` for the frontend before starting it.

## 4. Sign in

1. Open `http://localhost:3000`.
2. Choose sign-in or sign-up and enter a valid email address or phone number.
3. Request the verification code.
4. For local development, enter **123456**. The API response explains that no email or WhatsApp message was sent; the code is shown only for local development.
5. Confirm that the authenticated dashboard loads.
6. Reload the page and confirm the session is restored.

The OTP is a fixed development code. No email or WhatsApp message is sent. Do not use this flow as production authentication. Verify logout from the profile menu in the header, then sign in again if continuing the test.

## 5. Test bill capture, upload, and review

1. Choose **Scan Bill**. It should open the scan screen and request camera permission for a live preview when supported.
2. Capture a photo from the live preview, or use **Use device camera** as a camera-picker fallback. Confirm the capture goes to bill preview before upload; it should not start OCR/upload automatically.
3. To test gallery/file upload separately, choose **Upload Bill** and select an image or PDF.
4. From preview, continue to upload the bill. The backend accepts images and PDFs up to 10 MB.
5. Wait for processing. The app polls the extraction endpoint.
6. Review the extracted merchant, date, bill number, total, tax, currency, payment method, and confidence indicators.
7. Edit at least one field to confirm manual correction works.
8. Select a view/category and set the personal marker if desired.
9. Confirm/save the bill.
10. Verify the bill appears in the bill list with an appropriate status.
11. Open the bill file and confirm the uploaded image/PDF can be retrieved.

**OCR test expectation:** the backend runs PaddleOCR locally using its PP-OCRv6_medium multilingual pipeline. It recognizes image content and renders PDF pages locally (up to 10 pages) before recognition. Text patterns estimate common receipt fields; values are marked uncertain and require manual correction. Test with clear, non-sensitive receipt images and PDFs, including visible amounts and currency symbols. OCR accuracy has not been benchmarked; review and correct extracted fields.

**Image preview test:** open a saved bill and verify its original image displays in the detail dialog. Repeat with a shared bill. If a file cannot be loaded, the UI should show a short retry message; detailed request errors should be in the browser developer console.

**Non-bill test:** upload a non-receipt image (for example, a landscape photo). The app should show a clear “does not look like a bill or receipt” message with guidance to upload a sharp, well-lit bill, invoice, or receipt. It should not fill the form with unrelated text or a default category, and it must not allow the upload to be confirmed as an expense. The bill list should label the upload “Not a bill” and show no amount.

## 6. Test bill listing and organization

1. Upload and confirm multiple sample bills.
2. Search by a merchant name or bill number.
3. Filter by view and category.
4. Try date ranges (including a custom range if available).
5. Create a new view with a recognizable name.
6. Move a bill to a different view, then reload and verify the assignment persists.
7. Create or select a category/subcategory and verify it is available in bill review/filtering.
8. Open an existing bill and confirm the saved values and file are present.

## 7. Test sharing with two accounts

1. In the first browser/session, sign in as account A and create a bill or view to share.
2. From a bill row, bill details, or a view, open Share. Confirm it appears as a centered popup, not attached to the bottom of the screen.
3. Select a previously used recipient contact, or choose **+ Add someone new** and enter account B’s exact email or phone contact. This build does not provide a preloaded company contact directory or names; saved contacts come from existing shares.
4. Select one expiry option (7, 30, 90 days, or never) and create the share.
5. Confirm the recipient count/list updates and the share appears under outgoing shares.
6. Open a private/incognito browser window or another browser profile and sign in as account B using the same contact used in the share.
7. Open incoming shares and verify the shared bill/view is visible.
8. Confirm account B can read shared content but cannot modify or revoke account A’s share.
9. Return to account A and revoke the share.
10. Confirm it disappears from outgoing shares and is no longer available as an active incoming share.

Sharing is authenticated and contact-based; there is no anonymous URL that can be opened without signing in.

## 8. Test file validation and access boundaries

- Try a file larger than 10 MB and verify upload is rejected.
- Try a non-image/non-PDF file and verify upload is rejected.
- Sign in as a second user and try to access account A’s private bill ID; access should be denied/not found.
- Confirm normal owner access to the bill still works.
- Confirm shared access works only for an active share.

Use disposable test accounts and files. Avoid uploading real financial or personal information to a local demo.

## 9. Test responsive behavior

Use browser developer tools to check approximate widths:

- Mobile: 375px
- Tablet: 768px
- Desktop: 1280px

At each width, inspect navigation, upload/review form, bill list, filters, sharing dialogs, and buttons. Confirm the share popup remains centered and its content scrolls within the popup on narrow screens. On mobile, open the views, category, and date filters one at a time; confirm each opens as a bottom sheet, can be dismissed, and applying a selection updates the list. Verify controls remain visible, usable, and do not overlap. In an authenticated session, open the profile menu and use Log out; confirm the app returns to sign-in. Also test browser zoom and keyboard focus where time permits.

## 10. Build checks

Run these from the repository root (each command runs in a subshell, so the working directory remains the repository root):

```sh
(cd frontend && npm run build)
```

```sh
(cd backend && npm run build && npx prisma validate)
```

These are build/schema checks, not an automated functional test suite. `backend/package.json` currently defines `npm test` as a placeholder that exits with an error. Manual API/browser checks are required until tests are added.

## 11. Troubleshooting

| Symptom | Check |
|---|---|
| Frontend cannot contact API | Confirm the backend is listening on port 4000 and `NEXT_PUBLIC_API_BASE` points to `/api`. Check `FRONTEND_ORIGINS` for the frontend origin. |
| OTP does not work | Use `123456` in local development and check that both API requests use the same normalized contact. |
| API fails at startup | Check `backend/.env`, database URL, port 4000 availability, and Prisma migration status. Do not paste secrets into tickets or chat. |
| Bill upload rejected | Verify it is an image or PDF and is at most 10 MB. |
| Bill file cannot be decrypted | Verify `ENCRYPTION_KEY` has not changed since the bill was uploaded and the encrypted file still exists. |
| Extracted details do not match bill | OCR reads the uploaded file, but OCR recognition and heuristic field parsing can be wrong or incomplete. Review and correct the fields before confirming the bill. |
| Database migration issue | Back up the database first; confirm the correct `DATABASE_URL` is selected before migration commands. |

## Completion checklist

- [ ] API and frontend start locally.
- [ ] Email/WhatsApp method selection, local OTP sign-in, session restoration, and logout work. Confirm the local response says no message was sent.
- [ ] Image and PDF upload succeeds; invalid/oversized files are rejected.
- [ ] Real local OCR runs on image and PDF files; candidate fields can be reviewed and corrected before saving.
- [ ] Search, filters, views, categories, and moves persist.
- [ ] Bill file retrieval works.
- [ ] Bill/view sharing, incoming shares, and revocation work across two accounts.
- [ ] Owner/private access restrictions behave as expected.
- [ ] Layout has been checked at mobile, tablet, and desktop widths; mobile filters open one at a time and logout returns to sign-in.
- [ ] Frontend/backend builds and Prisma validation pass.
