# ird-cbms

A small client for Nepal IRD's Central Billing Monitoring System (CBMS) API. Use it to post sales bills and credit notes (sales returns) to CBMS.

It checks each bill before sending it, because CBMS has accepted bills whose amounts don't add up.

## Requirements

- Node.js 18 or later (uses the built-in `fetch`)
- The package is an ES module. From a CommonJS project, load it with `const { default: CBMS, CBMSError } = await import("ird-cbms");`

## Install

The package isn't on npm, and its GitHub repo is private for now. Once you have read access, install it from GitHub:

```sh
npm install github:Manjish/ird-cbms
```

## Quick start

```js
import CBMS, { CBMSError } from "ird-cbms";

const cbms = new CBMS({
  username: "Test_CBMS", // live mode: your taxpayer login user ID
  password: "test@321", // live mode: your taxpayer login password
  pan: "999999999", // live mode: your PAN (sent as seller_pan)
});

try {
  const result = await cbms.postBill({
    buyer_pan: "123456789",
    buyer_name: "",
    fiscal_year: "2083.084",
    invoice_number: `TEST-${Date.now()}`, // the test account is shared: use a number nobody has used
    invoice_date: "2083.06.14",
    total_sales: 1130,
    taxable_sales_vat: 1000,
    vat: 130,
  });
  console.log(result); // { code: "200", message: "Success" }
} catch (error) {
  if (error instanceof CBMSError) {
    // CBMS rejected the bill, or the request failed
    console.error(error.code, error.message); // e.g. "101" "Bill already exists"
  } else {
    // TypeError: the bill failed validation and nothing was sent
    throw error;
  }
}
```

## Posting a credit note

`postBillReturn` works the same way. In place of `invoice_number` and `invoice_date`, it takes the original bill's invoice number and the credit note's own details. Send the amounts being credited as positive numbers, as IRD's sample credit note does. The library rejects negative amounts.

```js
await cbms.postBillReturn({
  buyer_pan: "123456789",
  fiscal_year: "2083.084",
  ref_invoice_number: "INV-0001", // invoice_number of the original bill
  credit_note_number: "CN-0001",
  credit_note_date: "2083.06.20",
  reason_for_return: "Damaged item",
  total_sales: 565, // half the items returned
  taxable_sales_vat: 500,
  vat: 65,
});
```

## Bill fields

### Required text fields

- Both methods: `fiscal_year`
- `postBill`: `invoice_number`, `invoice_date`
- `postBillReturn`: `ref_invoice_number`, `credit_note_number`, `credit_note_date`, `reason_for_return`

Each must be a string with at least one non-space character.

`buyer_pan` is optional. For a buyer who has no PAN, leave it out or send `""`; on the test account, CBMS accepted both. `null` also passes the library's check and is sent as `null`, but how CBMS handles that hasn't been tested. Any other value must be a string, because a number such as `123456789` is rejected.

Write dates in Bikram Sambat as `YYYY.MM.DD`, for example `"2083.06.14"`, and the fiscal year as `"2083.084"` for 2083/84. That's the format IRD's own examples use. The library doesn't check formats, so a wrong one goes straight to CBMS.

### Amounts

| Field | Rule |
|---|---|
| `total_sales` | Required. The full bill amount, greater than 0. |
| `taxable_sales_vat` | Optional. The amount VAT was charged on, before adding VAT. |
| `vat` | Optional. The 13% VAT on `taxable_sales_vat`. |
| `tax_exempted_sales` | Optional. VAT-exempt sales, such as rice or medicine. |
| `export_sales` | Optional. Zero-rated export sales. |

Every amount you give must be a finite number that isn't negative. Strings such as `"500"`, `NaN` and `Infinity` are rejected.

The total must match its parts, to within 1 rupee:

```
total_sales = taxable_sales_vat + vat + tax_exempted_sales + export_sales
```

For this check, a missing or `null` amount counts as 0. The bill is still sent as you gave it: a missing field stays missing and `null` is sent as `null`. To be sure CBMS receives 0, send `0`.

A bill that mixes VAT-able and exempt items is fine:

```js
// 1,000 of VAT-able goods + 130 VAT + 500 of VAT-exempt rice
{ total_sales: 1630, taxable_sales_vat: 1000, vat: 130, tax_exempted_sales: 500 }
```

Bills with no VAT at all, such as export-only or exempt-only bills, are accepted too.

This sum is the only amount check. In particular:

- **The VAT rate isn't checked.** `{ total_sales: 1010, taxable_sales_vat: 1000, vat: 10 }` is accepted and sent, so calculating VAT correctly is up to you.
- **HST and ESF aren't part of the sum.** A bill whose `total_sales` includes `hst` or `esf` is rejected.
- **Excise is treated as part of `taxable_sales_vat`.** VAT is charged on the price including excise (VAT Act 2052, s.12(2)(b)). IRD's API document doesn't say how excise maps onto its fields, so the library assumes it's already in `taxable_sales_vat` and doesn't add it a second time.

### Other fields

The library sends every field in the bill exactly as you gave it. That includes fields it doesn't recognise, so a misspelled field name goes to CBMS without any warning. Text isn't trimmed.

These fields have no checks at all:

| Field | Notes |
|---|---|
| `buyer_name` | |
| `excisable_amount`, `excise` | |
| `taxable_sales_hst`, `hst` | Health Service Tax |
| `amount_for_esf`, `esf` | Education Service Fee |
| `datetimeClient` | IRD's field tables spell it this way and type it as a date-time. IRD's C# samples write `datetimeclient`. |
| `isrealtime` | Defaults to `true`. IRD doesn't define it. The name suggests it marks bills sent at the time of sale, so consider `false` for bills you post later, such as ones queued while offline. |

The client always sets `username`, `password` and `seller_pan` from its own credentials, overriding any values in the bill.

## Responses and errors

On success, both methods return `{ code: "200", message: "Success" }`. The client sends each request once and never retries.

**Validation errors** are thrown as a `TypeError` before anything is sent. Examples: `total_sales is required`, `vat cannot be negative`, or a total that doesn't match its parts.

**CBMS and network errors** are thrown as a `CBMSError`:

| Property | Meaning |
|---|---|
| `code` | The code CBMS returned, such as `"101"`. On a credit note, `101` and `102` become `"101-return"` and `"102-return"`. CBMS sends some codes as an HTTP error, such as `104` as an HTTP 400 with body `{"message":"104"}`. When an HTTP error's JSON body has a `message` that is one of the codes below, `code` is set to it. If a successful HTTP response isn't a code the client recognises, `code` is the whole response body. Not set for timeouts, network errors, empty responses, responses that couldn't be read, or other HTTP errors. |
| `status` | The HTTP status. Set only for HTTP errors, empty responses and responses that couldn't be read. |
| `responseText` | What CBMS actually sent, with surrounding whitespace trimmed. For HTTP errors, only the first 500 characters. For example, it's `"102"` when `code` is `"102-return"`, or `{"message":"104"}` for a code sent as an HTTP error. For an HTTP error whose body was empty or couldn't be read, it's `""`. Not set for timeouts, network errors, or successful responses that were empty or couldn't be read. |
| `cause` | The underlying error when the request failed or timed out, or when a successful response's body couldn't be read. For a timeout, `error.cause.name` is `"TimeoutError"`. |

### CBMS codes

`CBMS_MESSAGES` is exported and holds these messages, plus `200: "Success"`.

| Code | Message | What to do |
|---|---|---|
| `100` | API credentials do not match | Check the `username`, `password` and `pan` you passed to `new CBMS()`. |
| `101` | Bill already exists | CBMS already has this invoice number. If this was a retry, the earlier attempt went through. See [If a request fails](#if-a-request-fails). On the test account, a number was also rejected when re-sent under a different `fiscal_year`. |
| `101-return` | Bill does not exists | IRD documents this code, but it never came back on the test account. See the note below this table. |
| `102` | Exception while saving bill details. Please check model fields and values | Check field names and value types. Don't retry without changing anything. |
| `102-return` | Exception while saving credit note. Check that ref_invoice_number matches a bill already posted to CBMS | CBMS sent `102` for a credit note. On the test account, this is what came back when `ref_invoice_number` matched no posted bill. Check that first, then the other fields. |
| `103` | Unknown exceptions. Please check API URL and model fields and values | Same as `102`. |
| `104` | Model invalid | Same as `102`. On the test account, CBMS sent this as an HTTP 400 with body `{"message":"104"}`. |
| `105` | Bill does not exists (for Sales Return) | IRD documents this code, but it never came back on the test account. See the note below this table. |

For credit notes, IRD's document lists `101` and `105` as "bill does not exists". On the test account, a credit note whose `ref_invoice_number` matched no posted bill returned `102` instead, every time. That's why the client reports a `102` on a credit note as `102-return`, with a message pointing at `ref_invoice_number`.

### If a request fails

If a `CBMSError` has no `code`, or a `code` that isn't in `CBMS_MESSAGES`, you can't tell whether CBMS saved the bill. That covers timeouts, network errors, empty responses, responses that couldn't be read, HTTP errors without a known CBMS code, and responses the client didn't recognise, such as an HTML page from a proxy. To find out, send the same bill again with the **same** `invoice_number`:

- `200` means it's saved now.
- `101` means the first attempt was saved.

Never give a bill a new invoice number to get past a `101`, because that reports the sale twice.

**This doesn't work for credit notes.** CBMS doesn't reject a duplicate credit note. On the test account, the same credit note sent twice returned `200` both times, so resending one can record it twice. CBMS also accepted credit notes whose `fiscal_year` or `buyer_pan` differed from the original bill, and one for more than the bill's total. The only thing it checked was that `ref_invoice_number` matched a posted bill.

## Testing against CBMS

Test mode and live mode use the same URL. IRD's API document uses these test credentials in its samples:

| Setting | Value |
|---|---|
| `username` | `"Test_CBMS"` |
| `password` | `"test@321"` |
| `pan` | `"999999999"` |

`new CBMS()` needs all three as non-empty strings. A numeric `pan` such as `999999999` is rejected.

For live mode, use your taxpayer login's user ID and password and your own PAN. If you change the taxpayer login password, change the `password` you pass to `new CBMS()` too. Until you do, every post fails with `100`.

When testing:

- **Use a new `invoice_number` every time.** CBMS returns `101` for an invoice number it has already recorded. The test credentials are public, so other developers post to the same account. Putting a timestamp in the number avoids clashes.
- **Don't rely on CBMS to reject wrong amounts.** On the test account, it accepted a bill with `total_sales` 10, `taxable_sales_vat` 0 and `vat` 130. IRD's document doesn't say what CBMS validates. The library's checks run in `postBill` and `postBillReturn`. `postRequest` is used internally and skips every check, so don't call it directly.

## Configuration

These are static properties, so changing one affects every client:

| Property | Default |
|---|---|
| `CBMS.TIMEOUT_MS` | `20000` (20 seconds) |
| `CBMS.BASE_URL` | `"https://cbapi.ird.gov.np"` |

```js
CBMS.TIMEOUT_MS = 30_000;
```

## License

MIT. See [LICENSE](LICENSE).
