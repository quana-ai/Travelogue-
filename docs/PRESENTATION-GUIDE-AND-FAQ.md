# Travelogue: Presentation Guide and Management Q&A

## Recommended presentation flow

### 1. Start with the problem

“Travelogue is intended to make bill capture and expense organization easier. Instead of leaving receipts scattered across a phone or inbox, a user can upload a bill, review its details, organize it into a view and category, and share it with the relevant person.”

Be explicit that this implementation is a working MVP/demo, not a production-ready financial platform.

### 2. Explain the user journey

Show this sequence in the live demo:

1. Choose email or WhatsApp, then sign in with the local development OTP.
2. Choose Scan Bill and show the camera-first screen; capture a photo or use the separate upload option.
3. Show the processing and extraction status.
4. Explain the confidence labels and correct a field during review.
5. Save the bill into a view/category.
6. Search and filter the saved bill.
7. On a mobile viewport, show the views/category/date filter bottom sheets and that only one is open at a time.
8. Share a bill or view from the centered popup with another account and show the incoming share. The current build reuses contacts from previous shares or accepts a new email/WhatsApp contact; it does not have a preloaded company directory or names.
9. Revoke the share and show that it is no longer active, then demonstrate Log out.

### 3. Explain the architecture in one minute

“The UI is a Next.js/React application. It calls a NestJS API using JSON or multipart file uploads. The API validates the request, checks the JWT, and uses Prisma to persist data in SQLite. Bill fields and receipt files are encrypted with AES-256-GCM before storage. OCR runs locally using PaddleOCR; PDF pages are rendered locally with PDF.js. Field extraction uses heuristics, so users must check every suggested value.”

### 4. Explain the value of the review step

“Extraction should not be treated as truth. The user sees the result, confidence labels, and missing/uncertain fields, then corrects the data before saving it. The final status distinguishes a complete verified bill from one that still needs review.”

### 5. Explain sharing and privacy

“A user shares a bill or view to a recipient contact, optionally with an expiry. The recipient signs in to see incoming shares; the share is read-only, and the owner can revoke it. This is not a public anonymous link.”

### 6. Close with current readiness and next steps

- The main local UI/API workflows are implemented and the frontend/backend build checks pass; do not imply that every interaction has been manually verified.
- Local open-source OCR is implemented, but extraction accuracy has not been benchmarked and production workload scaling remains to be engineered.
- Email/WhatsApp OTP delivery is not implemented; local mode displays a development code and does not send messages.
- Before production, the team must complete provider selection, operational deployment, secret/key management, automated testing, and security review.
- Exact conformance to the missing prototype and technical design cannot be confirmed until those source documents are restored.

## Suggested demo preparation

- Start both the API and frontend and sign in before the meeting.
- Use a disposable demo account and non-sensitive sample files.
- Have a second browser profile ready for incoming-share testing.
- The recipient picker is populated from contacts already used in shares. If demonstrating reuse, create a first share to the demo account before the meeting; do not present invented sample names as a real address book.
- Show logout by opening the profile control in the header.
- Use a clear sample image or PDF. OCR runs on the uploaded file, but field parsing is heuristic; verify the detected details against the sample and correct at least one field. Do not promise specific extraction results.
- If demonstrating mobile filters, use a mobile viewport and test the views, category, and date sheets before presenting.
- Make sure the API is available and the local OTP response is visible; no email or WhatsApp message is actually sent.
- Keep screenshots or a short recording as backup if the local service or network fails.
- Avoid showing `.env`, real contacts, real bills, or live secrets on screen.

## Likely questions and suggested answers

### Product and feature questions

**Q1. What problem does Travelogue solve?**
It provides a single workflow for capturing bills, reviewing their details, organizing them by views/categories, finding them later, and sharing selected records. The current build performs local text recognition, but field parsing is heuristic and requires user verification.

**Q2. What is complete today?**
The responsive frontend is wired to a persistent API for local OTP login, bill uploads, editable extraction review, bill storage/listing/search/filtering, views/categories, encrypted file retrieval, and read-only expiring shares. Build checks pass. The exact intended prototype/architecture comparison is pending because the specification HTML files are absent.

**Q3. Is every screen backed by persisted data?**
The core bill, view, category, and share operations call backend APIs and persist in SQLite. OCR runs locally; there is no OCR vendor call. Share recipients are entered directly; the app does not maintain a company contact directory.

**Q4. Can a user correct extracted information?**
Yes. The extraction result is presented for review and fields can be edited before confirmation. The confirmed values are what the application persists as the bill record.

**Q5. How does a user find expenses?**
The bill list supports merchant/invoice text search and filters for views, categories, and dates. Because sensitive merchant and invoice values are encrypted in storage, text search decrypts the user’s records for filtering in application memory; this may need redesign for large datasets.

### OCR questions

**Q6. Which OCR API or library are we using?**
There is no hosted OCR API. The backend uses PaddleOCR PP-OCRv5 locally with an English recognition model. PDF.js renders PDF pages, and `@napi-rs/canvas` supplies the local canvas implementation. PaddleOCR and PaddlePaddle are open-source under Apache 2.0; receipt fields are estimated with application-side text-pattern rules.

**Q7. Does OCR read the uploaded image or PDF?**
Yes. The backend first uses PaddleOCR's text detector to filter out images without a document-like text layout, then recognizes text only on candidate images/pages. PDFs are rendered locally before detection, up to 10 pages. No receipt is sent to a cloud OCR service. Password-protected or unsupported documents can fail and require manual entry.

**Q8. How does OCR field extraction work, and what happens to a non-bill image?**
PaddleOCR recognizes text on document-like candidates. Local rules search that text for date, invoice/bill number, totals, tax, currency, payment terms, and item lines. The backend requires a total plus bill-specific signals before it stores the file or creates a record. If validation fails, it asks the user to upload a valid bill or receipt and saves neither the image nor a bill record. This is a heuristic, not a trained semantic bill classifier: text-heavy screenshots may undergo text recognition before being rejected, and unusual layouts or non-English bills can be rejected.

**Q9. How accurate is the OCR?**
No accuracy claim can be made because it has not been benchmarked on a representative dataset. OCR output depends on image quality, layout, fonts, language, and the rule-based parser. Measure field-level precision/recall on consented, representative receipts before relying on it for automated accounting.

**Q10. Why choose open-source local OCR instead of a cloud API?**
PaddleOCR is the selected local, open-source engine. Its text detector supports a pre-recognition document-layout screen and its English recognition model avoids OCR vendor credentials, per-page cloud charges, and transmission of bills to a hosted OCR API. This is an integration choice, not a result of a comparative accuracy benchmark. Cloud OCR services can offer managed capabilities but require accounts/network access and sending documents to the provider. Benchmark accuracy, language support, cost, privacy, and operations on consented sample bills before production use.

### Technical and data questions

**Q11. What is the technology stack?**
Frontend: Next.js 15, React 19, TypeScript. Backend: NestJS 10 and TypeScript. Data access: Prisma ORM with SQLite for this local MVP. Authentication uses JWT/Passport. Upload handling uses NestJS’s Multer integration. Encryption uses Node.js built-in `crypto`.

**Q12. Where is the data stored?**
Local structured records are in the SQLite database configured by `DATABASE_URL`. Encrypted receipt files are stored under `backend/uploads/`. This is a local-development storage arrangement, not a production storage architecture.

**Q13. How are bill records protected?**
Merchant, bill number, total, tax, and payment values are encrypted using AES-256-GCM with a fresh IV and authentication tag. Uploaded file bytes are also encrypted with AES-256-GCM, and a SHA-256 hash is checked after decryption. Date, currency, category, status, MIME type, and relationship metadata are not encrypted in the current schema.

**Q14. Is encryption end-to-end?**
No. This is server-side encryption at rest. The backend holds the configured key and decrypts data for authorized API responses. It is not end-to-end encryption where only user devices hold the key.

**Q15. What happens if the encryption key is lost or rotated?**
Existing encrypted fields and files cannot be decrypted with a different key. Key backup, access control, rotation/migration, and recovery procedures must be designed before production. Do not change the local key after creating data that needs to remain readable.

**Q16. Is the file hash itself encryption?**
No. SHA-256 is used as an integrity check after decryption. AES-GCM provides encryption and authentication of ciphertext; the hash additionally verifies that the decrypted file matches the recorded original content.

**Q17. How does authentication work?**
The user explicitly chooses email or WhatsApp and enters that destination. In local development, the API stores a hash and expiry but does not send a message; it returns the fixed code `123456` in its response. Successful verification issues a JWT, which the browser stores in local storage and sends as a bearer token. Production email and WhatsApp delivery still need provider integrations and a session/security review.

**Q18. Is the authentication ready for production?**
No. Email/WhatsApp OTP delivery is not configured. Production OTP requests deliberately return an unavailable error rather than pretending a code was delivered. Also, the browser local-storage token design should be evaluated against the production threat model.

**Q19. Why SQLite? Should it be used in production?**
SQLite keeps local setup simple for an MVP. The repository does not establish that SQLite is the approved production database. Deployment scale, concurrent workload, backup/restore, availability, and operational standards should guide whether to retain or replace it.

**Q20. What does sharing allow, and can anyone with a link access a bill?**
Shares are tied to an email/phone recipient, read-only, optionally expiring, and revocable. The recipient signs in to see active incoming shares. The product does not currently implement an anonymous public share link.

**Q21. How long do OTPs last, and are attempts limited?**
The local OTP record expires after five minutes. Verification is limited to five failed attempts for the latest unexpired code, and OTP requests are rate-limited to five per contact in a ten-minute period. The fixed development code is still not appropriate for production.

**Q22. Are users’ bills isolated from each other?**
The API uses JWT identity and service-level ownership checks for private bill and view operations. Incoming share access is limited to matching recipients and active shares. Authorization should still receive an independent security review and automated regression tests before production.

### Quality, readiness, and roadmap questions

**Q23. What automated tests are available?**
The frontend and backend production builds and Prisma schema validation pass. The backend test script is a placeholder that exits with an error, and there is no formal automated test suite. A direct OCR smoke check has been run with generated image and PDF receipts, but the authenticated browser workflow and mobile filter interactions have not been fully verified; consult the testing guide for the remaining manual checks.

**Q24. How was responsiveness checked?**
The interface includes responsive styles and the mobile filter bottom-sheet interaction. A complete authenticated manual check at 375px (mobile), 768px (tablet), and 1280px (desktop) remains to be done using the testing guide. A broader browser/device matrix and automated visual/accessibility testing are also follow-up work.

**Q25. What are the biggest remaining production gaps?**
Production OTP delivery, OCR field-extraction evaluation and scaling, production-grade database/file storage and backups, secret/key management and rotation, automated tests, monitoring/operational error handling, and security/privacy review. The missing prototype/technical-design HTML should also be restored to confirm requirements.

**Q26. What is the main risk of demonstrating the current OCR?**
People may assume heuristic field parsing is reliable enough for unattended financial processing. Explain that OCR is real and local, but values are unverified candidates; the user must review them and accuracy needs measurement before production reliance.

**Q27. What is needed to make OCR production-ready?**
Benchmark local recognition and parsing on consented receipts, extend language support if required, improve parsing/field confidence, add automated regression samples, and move processing to a bounded queue with timeouts and monitoring. If local OCR quality is insufficient, compare document-AI providers for accuracy, data residency, cost, latency, retention, and compliance.

**Q28. What is needed before production launch?**
Restore and verify the formal requirements; configure production authentication and secrets; select database and file storage; plan key lifecycle, backups, retention and deletion; implement OCR and automated tests; conduct security, privacy, accessibility, and load reviews; then deploy with monitoring and incident procedures.

## Phrases to avoid in the presentation

- Avoid: “We use AI to read receipts.”  
  Say: “We run open-source OCR locally and use heuristic field parsing; users verify every candidate.”
- Avoid: “The data is end-to-end encrypted.”
  Say: “Selected bill fields and file contents are encrypted at rest by the backend using AES-256-GCM.”
- Avoid: “OTP is production-ready.”
  Say: “Local OTP is available without sending a message; production email/WhatsApp delivery is not configured.”
- Avoid: “All requirements have been matched exactly.”
  Say: “We implemented against the available code and README; the two referenced HTML specifications were not present to verify against.”

## One-minute closing

“Travelogue now demonstrates the user journey from sign-in through bill capture, editable OCR review, organization, search, and controlled sharing. The frontend and backend are connected, data persists locally, and sensitive bill fields and files are encrypted at rest. OCR is open-source and runs locally, but field extraction needs accuracy evaluation. OTP currently works only in local mode without sending messages. Our next milestone should integrate verified email and WhatsApp providers, add automated tests and production storage/security operations, and verify the missing design specifications.”
