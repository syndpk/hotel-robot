/**
 * passport.ts — Local passport/ID document extraction pipeline.
 *
 * Pipeline:
 *   1. Preprocess image with sharp (grayscale + normalise + sharpen).
 *   2. Crop the bottom 38 % of the image where the MRZ zone lives.
 *   3. Run OCR on the MRZ crop with tesseract.js (charset restricted to A–Z, 0–9, <).
 *   4. Attempt to parse MRZ lines with the `mrz` package.
 *      → Validates check digits, extracts all structured fields.
 *   5. If no MRZ found: run OCR on the full image and attempt heuristic extraction
 *      (name / DOB from visible text) with lower confidence.
 *   6. Return ParseResult with masked fields and validation details.
 *
 * Privacy: this module never writes the image buffer to disk.
 * Callers must not log the full ParseResult.rawFields (use .maskedFields only).
 */
/** Fields as returned to the LLM and shown in the UI — sensitive values masked. */
export interface IdentityMaskedFields {
    fullName?: string;
    surname?: string;
    givenNames?: string;
    nationality?: string;
    dateOfBirth?: string;
    /** Masked document number: first char + stars + last 3  →  "A***456" */
    documentNumber?: string;
    /** Last-2 fingerprint for desk quick-check  →  "****XY" */
    mrzMaskedLast6?: string;
    expiryDate?: string;
    issuingCountry?: string;
    documentType?: string;
    sex?: string;
}
/** Internal full fields — never sent to LLM, only used for masking/validation. */
export interface IdentityRawFields {
    fullName?: string;
    surname?: string;
    givenNames?: string;
    nationality?: string;
    dateOfBirth?: string;
    documentNumber?: string;
    expiryDate?: string;
    issuingCountry?: string;
    documentType?: string;
    sex?: string;
    mrzLines?: string[];
}
export interface IdentityConfidences {
    fullName: number;
    nationality: number;
    dateOfBirth: number;
    documentNumber: number;
    expiryDate: number;
    issuingCountry: number;
    overall: number;
}
export interface IdentityValidation {
    mrzFound: boolean;
    mrzFormat: 'TD1' | 'TD2' | 'TD3' | 'MRVA' | 'MRVB' | 'UNKNOWN';
    mrzChecksumPassed: boolean;
    failedChecksums: string[];
    errors: string[];
}
export interface ParseResult {
    ok: boolean;
    maskedFields: IdentityMaskedFields;
    confidences: IdentityConfidences;
    validation: IdentityValidation;
    errors: string[];
    /** Raw fields — MUST NOT be sent to LLM or logged. Caller owns masking responsibility. */
    rawFields: IdentityRawFields;
}
/**
 * Parse a passport/ID image buffer using local OCR + MRZ parsing.
 * No network calls are made. The image buffer is not persisted.
 *
 * @param imageBuffer — JPEG, PNG, or WebP byte buffer
 */
export declare function parseDocument(imageBuffer: Buffer): Promise<ParseResult>;
