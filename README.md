# EventArt OS — Version 1.0

EventArt OS is a private event-planning workspace connected to the existing EventArt Airtable base. It does not create, rename, delete, or recreate Airtable tables or fields.

## Private Airtable setup

1. Make a copy of `.env.example` and name the copy `.env.local`.
2. Open `.env.local`.
3. Replace `your_private_airtable_token` with your Airtable Personal Access Token.
4. Save the file.

The `.env.local` file is private and excluded from source control. The token is used only by the server; it is never sent to the browser.

## Start the private preview

1. Open the project in Codex.
2. Ask Codex: **“Start my private EventArt OS preview.”**
3. Open the local address Codex provides.

## Airtable safety

- Existing tables and fields are used exactly as inspected.
- Tasks use the existing **Timeline** table.
- Seating Chart uses the existing **Seating Tables** table.
- Version 1.0 can read records and edit existing records.
- Creating new records is intentionally disabled.
- The app has not been deployed or published.
