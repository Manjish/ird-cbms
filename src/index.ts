export const CBMS_MESSAGES: Record<string, string> = {
  200: "Success",
  100: "API credentials do not match",
  101: "Bill already exists",
  "101-return": "Bill does not exists",
  102: "Exception while saving bill details. Please check model fields and values",
  "102-return":
    "Exception while saving credit note. Check that ref_invoice_number matches a bill already posted to CBMS",
  103: "Unknown exceptions. Please check API URL and model fields and values",
  104: "Model invalid",
  105: "Bill does not exists (for Sales Return)",
};

export interface CBMSCredentials {
  username: string;
  password: string;
  pan: string;
}

interface BillBase {
  fiscal_year: string;
  buyer_pan?: string | null;
  buyer_name?: string;
  total_sales: number;
  taxable_sales_vat?: number | null;
  vat?: number | null;
  tax_exempted_sales?: number | null;
  export_sales?: number | null;
  excisable_amount?: number | null;
  excise?: number | null;
  taxable_sales_hst?: number | null;
  hst?: number | null;
  amount_for_esf?: number | null;
  esf?: number | null;
  datetimeClient?: string;
  isrealtime?: boolean;
}

export interface Bill extends BillBase {
  invoice_number: string;
  invoice_date: string;
}

export interface BillReturn extends BillBase {
  ref_invoice_number: string;
  credit_note_number: string;
  credit_note_date: string;
  reason_for_return: string;
}

export interface CBMSResult {
  code: "200";
  message: string;
}

export class CBMSError extends Error {
  // declare: emit no field initialisers, so properties keep the order they're assigned in.
  declare code: string | undefined;
  declare status: number | undefined;
  declare responseText: string | undefined;

  constructor(
    message: string,
    {
      code,
      status,
      responseText,
      cause,
    }: {
      code?: string;
      status?: number;
      responseText?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause });
    this.name = "CBMSError";
    this.code = code;
    this.status = status;
    this.responseText = responseText;
  }
}

function requiredStringCheck<T extends object>(
  data: T,
  keys: (keyof T & string)[],
): void {
  for (const k of keys) {
    const elem: unknown = data[k];
    if (typeof elem !== "string" || elem.trim() === "") {
      throw new TypeError(`${k} is required and must be a non-empty string`);
    }
  }
}

function optionalStringCheck<T extends object>(
  data: T,
  keys: (keyof T & string)[],
): void {
  for (const k of keys) {
    const elem: unknown = data[k];
    if (elem !== undefined && elem !== null && typeof elem !== "string") {
      throw new TypeError(`${k} must be a string`);
    }
  }
}

function assertObject(data: unknown, label: string): void {
  if (data === null || typeof data !== "object") {
    throw new TypeError(`${label} must be an object`);
  }
}

function checkNotZero<T extends object>(
  data: T,
  keys: (keyof T & string)[],
): void {
  for (const k of keys) {
    const elem: unknown = data[k];
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

function checkOptionalAmount<T extends object>(
  data: T,
  keys: (keyof T & string)[],
): void {
  for (const k of keys) {
    const elem: unknown = data[k];
    if (elem === undefined || elem === null) continue;

    if (typeof elem !== "number" || !Number.isFinite(elem)) {
      throw new TypeError(`${k} must be a finite number`);
    }
    if (elem < 0) {
      throw new TypeError(`${k} cannot be negative`);
    }
  }
}

function checkSalesAmounts(bill: Bill | BillReturn): void {
  const {
    total_sales,
    taxable_sales_vat,
    vat,
    tax_exempted_sales,
    export_sales,
  } = bill;
  const diff =
    total_sales -
    ((taxable_sales_vat ?? 0) +
      (vat ?? 0) +
      (tax_exempted_sales ?? 0) +
      (export_sales ?? 0));
  if (diff < -1 || diff > 1) {
    throw new TypeError(
      "The total_sales amount does not match up with the subitems total. Please recheck the values.",
    );
  }
}

function toCBMSCode<T extends string | undefined>(
  raw: T,
  isReturn: boolean,
): string | T {
  return isReturn && (raw === "101" || raw === "102") ? `${raw}-return` : raw;
}

function codeFromErrorBody(text: string): string | undefined {
  try {
    const { message }: { message?: unknown } = JSON.parse(text);
    return typeof message === "string" ? message.trim() : undefined;
  } catch {
    return undefined;
  }
}

function isTimeout(error: unknown): boolean {
  return (
    (error as { name?: unknown } | null | undefined)?.name === "TimeoutError"
  );
}

export default class CBMS {
  static BASE_URL = "https://cbapi.ird.gov.np";
  static TIMEOUT_MS = 20_000;
  username: string;
  password: string;
  pan: string;

  constructor(credentials: CBMSCredentials) {
    assertObject(credentials, "credentials");
    requiredStringCheck(credentials, ["username", "password", "pan"]);
    this.username = credentials.username;
    this.password = credentials.password;
    this.pan = credentials.pan;
  }

  async postBill(bill: Bill): Promise<CBMSResult> {
    assertObject(bill, "bill");
    requiredStringCheck(bill, [
      "fiscal_year",
      "invoice_number",
      "invoice_date",
    ]);
    optionalStringCheck(bill, ["buyer_pan"]);
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

  async postBillReturn(bill: BillReturn): Promise<CBMSResult> {
    assertObject(bill, "bill");
    requiredStringCheck(bill, [
      "fiscal_year",
      "ref_invoice_number",
      "credit_note_number",
      "credit_note_date",
      "reason_for_return",
    ]);
    optionalStringCheck(bill, ["buyer_pan"]);
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

  private async postRequest(
    path: string,
    bill: Bill | BillReturn,
    { isReturn = false }: { isReturn?: boolean } = {},
  ): Promise<CBMSResult> {
    const payload = {
      isrealtime: true,
      ...bill,
      username: this.username,
      password: this.password,
      seller_pan: this.pan,
    };
    const body = JSON.stringify(payload);
    let response: Response;
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
      const timedOut = isTimeout(error);
      throw new CBMSError(
        timedOut
          ? `CBMS did not respond within ${CBMS.TIMEOUT_MS}ms`
          : "CBMS request failed",
        { cause: error },
      );
    }

    if (!response.ok) {
      const text = (await response.text().catch(() => "")).trim();
      // CBMS sends some codes as an HTTP error, e.g. 400 {"message":"104"}.
      const code = toCBMSCode(codeFromErrorBody(text), isReturn);
      const known =
        code !== undefined &&
        code !== "200" &&
        Object.hasOwn(CBMS_MESSAGES, code);
      throw new CBMSError(
        known ? CBMS_MESSAGES[code] : `CBMS HTTP ${response.status}`,
        {
          code: known ? code : undefined,
          status: response.status,
          responseText: text.slice(0, 500),
        },
      );
    }

    let responseText: string;
    try {
      responseText = (await response.text()).trim();
    } catch (error) {
      const timedOut = isTimeout(error);
      throw new CBMSError(
        timedOut
          ? `CBMS did not respond within ${CBMS.TIMEOUT_MS}ms`
          : "CBMS response could not be read",
        { status: response.status, cause: error },
      );
    }
    if (!responseText) {
      throw new CBMSError("CBMS returned an empty response body", {
        status: response.status,
      });
    }

    if (responseText === "200")
      return { code: "200", message: CBMS_MESSAGES[200] };

    const code = toCBMSCode(responseText, isReturn);
    const message = Object.hasOwn(CBMS_MESSAGES, code)
      ? CBMS_MESSAGES[code]
      : `CBMS returned unrecognised response: ${responseText}`;

    throw new CBMSError(message, { code, responseText });
  }
}
