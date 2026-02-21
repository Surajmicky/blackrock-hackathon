# BlackRock Retirement Savings API (Challenge)

TypeScript + Express implementation of the BlackRock API challenge.

## Overview

This service implements the required endpoints:

- `POST /blackrock/challenge/v1/transactions:parse`
- `POST /blackrock/challenge/v1/transactions:validator`
- `POST /blackrock/challenge/v1/transactions:filter`
- `POST /blackrock/challenge/v1/returns:nps`
- `POST /blackrock/challenge/v1/returns:index`
- `GET /blackrock/challenge/v1/performance`

It also exposes:

- `GET /health`
- Swagger UI at `GET /docs`
- OpenAPI JSON at `GET /docs.json`

## Requirements

- Node.js 20+
- npm

## Run locally

```bash
npm install
npm run dev
```

App starts on `http://localhost:5477`.

## Build and run (production)

```bash
npm install
npm run build
npm start
```

## Run with Docker

```bash
docker build -t blk-hacking-ind-suraj-kumar .
docker run -p 5477:5477 blk-hacking-ind-suraj-kumar
```

## API notes

- All timestamps support the challenge format `YYYY-MM-DD HH:mm:ss`.
- Colon routes are served exactly as written (e.g. `/transactions:parse`).

### 1) `POST /blackrock/challenge/v1/transactions:parse`

Request body is a raw JSON array:

```json
[
  { "date": "2023-10-12 20:15:30", "amount": 250 },
  { "date": "2023-02-28 15:49:20", "amount": 375 }
]
```

Response is a raw JSON array with `ceiling` and `remanent`:

```json
[
  { "date": "2023-10-12 20:15:30", "amount": 250, "ceiling": 300, "remanent": 50 },
  { "date": "2023-02-28 15:49:20", "amount": 375, "ceiling": 400, "remanent": 25 }
]
```

### 2) `POST /blackrock/challenge/v1/transactions:validator`

Validates negative amounts, duplicates, and ceiling/remanent consistency.

### 3) `POST /blackrock/challenge/v1/transactions:filter`

Accepts `wage` (optional) and raw transactions (`date` + `amount`). Returns:

- `valid`: parsed transactions with `isInPeriod: true`
- `invalid`: parsed transactions with `message`

### 4) Returns

- `POST /blackrock/challenge/v1/returns:nps`
- `POST /blackrock/challenge/v1/returns:index`

Both accept raw transactions (`date` + `amount`) and compute:

- `transactionsTotalAmount`
- `transactionsTotalCeiling`
- `savingsByDates` by `k` periods

## Swagger

Open Swagger UI:

- `http://localhost:5477/docs`


