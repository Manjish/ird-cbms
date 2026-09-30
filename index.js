export const CBMS_MESSAGES = {
  200: "Success",
  100: "API credentials do not match",
  101: "Bill already exists",
  "101-return": "Bill does not exists",
  102: "Exception while saving bill details. Please check model fields and values",
  103: "Unknown exceptions. Please check API URL and model fields and values",
  104: "Model invalid",
  105: "Bill does not exists (for Sales Return)",
};

export class CBMSError extends Error {
  constructor(message, { code, status, responseText, cause } = {}) {
    super(message, { cause });
    this.name = "CBMSError";
    this.code = code;
    this.status = status;
    this.responseText = responseText;
  }
}

function requiredStringCheck(data, keys) {
  for (const k of keys) {
    const elem = data[k];
    if (typeof elem !== "string" || elem.trim() === "") {
      throw new TypeError(`${k} is required and cannot be empty`);
    }
  }
}

function assertObject(data, label) {
  if (data === null || typeof data !== "object") {
    throw new TypeError(`${label} must be an object`);
  }
}

function checkNotZero(data, keys) {
  for (const k of keys) {
    const elem = data[k];
    if (elem === undefined || elem === null) {
      throw new TypeError(`${k} is required`);
    }

    if (typeof elem !== "number" || !Number.isFinite(elem)) {
      throw new TypeError(`${k} must be a finite number`);
    }
    if (elem === 0) {
      throw new TypeError(`${k} cannot be zero`);
    }
  }
}

function checkOptionalAmount(data, keys) {
  for (const k of keys) {
    const elem = data[k];
    if (elem === undefined || elem === null) continue;

    if (typeof elem !== "number" || !Number.isFinite(elem)) {
      throw new TypeError(`${k} must be a finite number`);
    }
    if (elem < 0) {
      throw new TypeError(`${k} cannot be negative`);
    }
  }
}

function checkSalesAmounts(bill) {
  const {
    total_sales,
    taxable_sales_vat = 0,
    vat = 0,
    tax_exempted_sales = 0,
    export_sales = 0,
  } = bill;
  const diff =
    total_sales - (taxable_sales_vat + vat + tax_exempted_sales + export_sales);
  if (diff < -1 || diff > 1) {
    throw new TypeError(
      "The total_sales amount does not match up with the subitems total. Please recheck the values.",
    );
  }
}

export default class CBMS {
  static BASE_URL = "https://cbapi.ird.gov.np";
  static TIMEOUT_MS = 20_000;
  constructor(credentials) {
    assertObject(credentials, "credentials");
    requiredStringCheck(credentials, ["username", "password", "pan"]);
    this.username = credentials.username;
    this.password = credentials.password;
    this.pan = credentials.pan;
  }

  async postBill(bill) {
    assertObject(bill, "bill");
    requiredStringCheck(bill, [
      "buyer_pan",
      "fiscal_year",
      "invoice_number",
      "invoice_date",
    ]);
    checkNotZero(bill, ["total_sales"]);
    checkOptionalAmount(bill, [
      "total_sales",
      "taxable_sales_vat",
      "vat",
      "tax_exempted_sales",
      "export_sales",
    ]);
    checkSalesAmounts(bill);
    return await this.postRequest("/api/bill", bill);
  }

  async postBillReturn(bill) {
    assertObject(bill, "bill");
    requiredStringCheck(bill, [
      "buyer_pan",
      "fiscal_year",
      "ref_invoice_number",
      "credit_note_number",
      "credit_note_date",
      "reason_for_return",
    ]);
    checkNotZero(bill, ["total_sales"]);
    checkOptionalAmount(bill, [
      "total_sales",
      "taxable_sales_vat",
      "vat",
      "tax_exempted_sales",
      "export_sales",
    ]);
    checkSalesAmounts(bill);
    return await this.postRequest("/api/billreturn", bill, { isReturn: true });
  }

  async postRequest(path, bill, { isReturn = false } = {}) {
    const payload = {
      isrealtime: true,
      ...bill,
      username: this.username,
      password: this.password,
      seller_pan: this.pan,
      // buyer_pan:"",
      // buyer_name: "",
      // fiscal_year: "",
      // invoice_number: "TST-001",
      // invoice_date: "2083.06.05",
      // total_sales:113,
      // taxable_sales_vat:100,
      // vat:13,
      // excisable_amount: 0,
      // excise: 0,
      // taxable_sales_hst: 0,
      // hst: 0,
      // amount_for_esf: 0,
      // esf: 0,
      // export_sales: 0,
      // tax_exempted_sales: 0,
      // datetimeclient: "",
    };
    const body = JSON.stringify(payload);
    let response;
    try {
      response = await fetch(`${CBMS.BASE_URL}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body,
        signal: AbortSignal.timeout(CBMS.TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error?.name === "TimeoutError";
      throw new CBMSError(
        timedOut
          ? `CBMS did not respond within ${CBMS.TIMEOUT_MS}ms`
          : "CBMS request failed",
        { cause: error },
      );
    }

    if (!response.ok) {
      const text = (await response.text().catch(() => "")).trim();
      throw new CBMSError(`CBMS HTTP ${response.status}`, {
        status: response.status,
        responseText: text.slice(0, 500),
      });
    }

    const responseText = (await response.text()).trim();
    if (!responseText) {
      throw new CBMSError("CBMS returned an empty response body", {
        status: response.status,
      });
    }

    if (responseText === "200")
      return { code: "200", message: CBMS_MESSAGES[200] };

    const code =
      isReturn && responseText === "101" ? "101-return" : responseText;
    const message =
      CBMS_MESSAGES[code] ??
      `CBMS returned unrecognised response: ${responseText}`;

    throw new CBMSError(message, { code, responseText });
  }
}
