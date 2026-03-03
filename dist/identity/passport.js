"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDocument = parseDocument;
const tesseract_js_1 = __importDefault(require("tesseract.js"));
const mrz_1 = require("mrz");
const sharp_1 = __importDefault(require("sharp"));
// ── Masking helpers ────────────────────────────────────────────────────────────
/** Mask document number: keep first char + last 3, replace middle with *** */
function maskDocumentNumber(num) {
    if (!num)
        return '';
    const cleaned = num.replace(/<+$/, ''); // strip trailing fill chars
    if (cleaned.length <= 4)
        return '****';
    return cleaned[0] + '*'.repeat(Math.max(2, cleaned.length - 4)) + cleaned.slice(-3);
}
/** Convert YYMMDD (MRZ date) to YYYY-MM-DD */
function mrzDateToISO(yymmdd) {
    if (!yymmdd || yymmdd.length !== 6)
        return yymmdd;
    const yy = parseInt(yymmdd.slice(0, 2), 10);
    const mm = yymmdd.slice(2, 4);
    const dd = yymmdd.slice(4, 6);
    // Heuristic: year < 30 → 2000s (expiry), year ≥ 30 → 1900s (birth/old expiry)
    const century = yy < 30 ? '20' : '19';
    return `${century}${String(yy).padStart(2, '0')}-${mm}-${dd}`;
}
/** Normalise country code from MRZ (3-char) to display string */
function countryCode(code) {
    if (!code)
        return undefined;
    return code.replace(/<+$/, '').trim() || undefined;
}
function docType(format) {
    switch (format) {
        case 'TD3': return 'PASSPORT';
        case 'TD1':
        case 'TD2': return 'ID_CARD';
        case 'MRVA':
        case 'MRVB': return 'VISA';
        default: return 'UNKNOWN';
    }
}
/**
 * Derive a 6-char "last-2 fingerprint" from the document number.
 * Shows only the final 2 characters, padded to 6 total with asterisks.
 * Safe to include in LLM context for quick desk-verification.
 */
function mrzFingerprint(num) {
    const cleaned = num.replace(/<+$/, '');
    if (cleaned.length < 2)
        return '******';
    return '****' + cleaned.slice(-2);
}
function maskFields(raw) {
    const maskedDocNum = raw.documentNumber ? maskDocumentNumber(raw.documentNumber) : undefined;
    const mrzMaskedLast6 = raw.documentNumber
        ? mrzFingerprint(raw.documentNumber)
        : undefined;
    return {
        fullName: raw.fullName,
        surname: raw.surname,
        givenNames: raw.givenNames,
        nationality: raw.nationality,
        dateOfBirth: raw.dateOfBirth,
        documentNumber: maskedDocNum,
        mrzMaskedLast6,
        expiryDate: raw.expiryDate,
        issuingCountry: raw.issuingCountry,
        documentType: raw.documentType,
        sex: raw.sex,
    };
}
// ── MRZ line detection ─────────────────────────────────────────────────────────
/**
 * Given raw OCR text, try to find MRZ-like lines:
 *   TD3: 2 lines of 44 chars (A-Z, 0-9, <)
 *   TD1: 3 lines of 30 chars
 *   TD2: 2 lines of 36 chars
 *
 * Returns the candidate lines or null if nothing plausible is found.
 */
function detectMRZLines(ocrText) {
    // Sanitise: keep only valid MRZ characters, split by newline
    const rawLines = ocrText.split(/\r?\n/);
    const sanitised = rawLines
        .map(l => l.replace(/[^A-Z0-9<]/g, '').trim())
        .filter(l => l.length > 0);
    // Try to find TD3 (2 × 44)
    const td3Candidates = sanitised.filter(l => l.length >= 40 && l.length <= 47);
    if (td3Candidates.length >= 2) {
        return td3Candidates.slice(-2).map(l => l.padEnd(44, '<').slice(0, 44));
    }
    // Try TD2 (2 × 36)
    const td2Candidates = sanitised.filter(l => l.length >= 33 && l.length <= 39);
    if (td2Candidates.length >= 2) {
        return td2Candidates.slice(-2).map(l => l.padEnd(36, '<').slice(0, 36));
    }
    // Try TD1 (3 × 30)
    const td1Candidates = sanitised.filter(l => l.length >= 27 && l.length <= 33);
    if (td1Candidates.length >= 3) {
        return td1Candidates.slice(-3).map(l => l.padEnd(30, '<').slice(0, 30));
    }
    return null;
}
// ── Heuristic full-image OCR fallback ──────────────────────────────────────────
/**
 * Very rough fallback extraction from non-MRZ documents or when MRZ fails.
 * Returns partial raw fields with low confidence flags.
 */
function heuristicExtract(fullOCRText) {
    const lines = fullOCRText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const result = {};
    // Surname / Given name: lines that look like all-caps names
    const nameLines = lines.filter(l => /^[A-Z][A-Z\s\-]{3,}$/.test(l));
    if (nameLines.length >= 1)
        result.surname = nameLines[0];
    if (nameLines.length >= 2)
        result.givenNames = nameLines[1];
    if (result.surname) {
        result.fullName = [result.givenNames, result.surname].filter(Boolean).join(' ');
    }
    // Date pattern: DD/MM/YYYY or DD.MM.YYYY or YYYY-MM-DD
    const dateRe = /\b(\d{2}[\/\.\-]\d{2}[\/\.\-]\d{4}|\d{4}[\/\.\-]\d{2}[\/\.\-]\d{2})\b/g;
    const dates = fullOCRText.match(dateRe) ?? [];
    if (dates.length >= 1 && dates[0])
        result.dateOfBirth = dates[0].replace(/[./]/g, '-');
    if (dates.length >= 2 && dates[1])
        result.expiryDate = dates[1].replace(/[./]/g, '-');
    return result;
}
// ── Main export ────────────────────────────────────────────────────────────────
const ZERO_CONF = {
    fullName: 0, nationality: 0, dateOfBirth: 0,
    documentNumber: 0, expiryDate: 0, issuingCountry: 0, overall: 0,
};
/**
 * Parse a passport/ID image buffer using local OCR + MRZ parsing.
 * No network calls are made. The image buffer is not persisted.
 *
 * @param imageBuffer — JPEG, PNG, or WebP byte buffer
 */
async function parseDocument(imageBuffer) {
    const errors = [];
    // ── 1. Preprocess full image ───────────────────────────────────────────────
    let processedFull;
    let mrzBuffer;
    try {
        const meta = await (0, sharp_1.default)(imageBuffer).metadata();
        const h = meta.height ?? 1000;
        const w = meta.width ?? 800;
        // Full image: greyscale + normalise contrast
        processedFull = await (0, sharp_1.default)(imageBuffer)
            .grayscale()
            .normalise()
            .sharpen()
            .toBuffer();
        // MRZ zone: bottom 38 % of the document
        const mrzTop = Math.max(0, Math.floor(h * 0.62));
        mrzBuffer = await (0, sharp_1.default)(imageBuffer)
            .grayscale()
            .normalise()
            .sharpen()
            .extract({ left: 0, top: mrzTop, width: w, height: h - mrzTop })
            .toBuffer();
    }
    catch (imgErr) {
        errors.push('IMAGE_PREPROCESSING_FAILED');
        return {
            ok: false, maskedFields: {}, rawFields: {},
            confidences: ZERO_CONF,
            validation: { mrzFound: false, mrzFormat: 'UNKNOWN', mrzChecksumPassed: false, failedChecksums: [], errors },
            errors,
        };
    }
    // ── 2. OCR the MRZ zone ────────────────────────────────────────────────────
    let mrzOCRText = '';
    let mrzWorker = null;
    try {
        mrzWorker = await tesseract_js_1.default.createWorker('eng', 1, { logger: () => { } });
        await mrzWorker.setParameters({
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
            // PSM 6: treat as a single uniform block (best for MRZ)
            tessedit_pageseg_mode: '6',
        });
        const { data } = await mrzWorker.recognize(mrzBuffer);
        mrzOCRText = data.text ?? '';
    }
    catch (ocrErr) {
        errors.push('MRZ_OCR_FAILED');
    }
    finally {
        if (mrzWorker)
            await mrzWorker.terminate().catch(() => { });
    }
    // ── 3. Try MRZ parsing ─────────────────────────────────────────────────────
    const mrzLines = detectMRZLines(mrzOCRText.toUpperCase());
    if (mrzLines) {
        let mrzResult = null;
        try {
            mrzResult = (0, mrz_1.parse)(mrzLines);
        }
        catch {
            errors.push('MRZ_PARSE_FAILED');
        }
        if (mrzResult) {
            const f = mrzResult.fields;
            const fmt = mrzResult.format;
            // Find failed check digits from details
            const failedChecksums = [];
            if (Array.isArray(mrzResult.details)) {
                for (const d of mrzResult.details) {
                    if (d.type === 'CHECK_DIGIT' && !d.valid) {
                        failedChecksums.push(d.field);
                    }
                }
            }
            const surname = (f['surname'] ?? '').replace(/<+$/, '').replace(/<+/g, ' ').trim();
            const givenNames = (f['firstName'] ?? f['givenNames'] ?? '').replace(/<+$/, '').replace(/<+/g, ' ').trim();
            const fullName = [givenNames, surname].filter(Boolean).join(' ') || undefined;
            const rawFields = {
                fullName,
                surname: surname || undefined,
                givenNames: givenNames || undefined,
                nationality: countryCode(f['nationality']),
                dateOfBirth: f['birthDate'] ? mrzDateToISO(f['birthDate']) : undefined,
                expiryDate: f['expirationDate'] ? mrzDateToISO(f['expirationDate']) : undefined,
                documentNumber: (f['documentNumber'] ?? '').replace(/<+$/, '') || undefined,
                issuingCountry: countryCode(f['issuingState']),
                documentType: docType(fmt),
                sex: (f['sex'] ?? undefined),
                mrzLines,
            };
            // Confidence: high when MRZ is valid, medium when checksum failed
            const baseConf = mrzResult.valid ? 0.92 : 0.60;
            const conf = {
                fullName: fullName ? baseConf : 0,
                nationality: rawFields.nationality ? baseConf : 0,
                dateOfBirth: rawFields.dateOfBirth ? baseConf : 0,
                documentNumber: rawFields.documentNumber ? baseConf : 0,
                expiryDate: rawFields.expiryDate ? baseConf : 0,
                issuingCountry: rawFields.issuingCountry ? baseConf : 0,
                overall: baseConf,
            };
            return {
                ok: true,
                rawFields,
                maskedFields: maskFields(rawFields),
                confidences: conf,
                validation: {
                    mrzFound: true,
                    mrzFormat: fmt,
                    mrzChecksumPassed: mrzResult.valid,
                    failedChecksums,
                    errors,
                },
                errors,
            };
        }
    }
    // ── 4. MRZ not found — fall back to full-image OCR ────────────────────────
    errors.push('MRZ_NOT_FOUND');
    let fullOCRText = '';
    let fullWorker = null;
    try {
        fullWorker = await tesseract_js_1.default.createWorker('eng', 1, { logger: () => { } });
        const { data } = await fullWorker.recognize(processedFull);
        fullOCRText = data.text ?? '';
    }
    catch {
        errors.push('FULL_IMAGE_OCR_FAILED');
    }
    finally {
        if (fullWorker)
            await fullWorker.terminate().catch(() => { });
    }
    if (!fullOCRText.trim()) {
        errors.push('NO_TEXT_DETECTED');
        return {
            ok: false, maskedFields: {}, rawFields: {},
            confidences: ZERO_CONF,
            validation: { mrzFound: false, mrzFormat: 'UNKNOWN', mrzChecksumPassed: false, failedChecksums: [], errors },
            errors,
        };
    }
    const heuristic = heuristicExtract(fullOCRText.toUpperCase());
    const hasAnyField = Object.values(heuristic).some(Boolean);
    const rawFields = { ...heuristic, documentType: 'UNKNOWN' };
    const lowConf = 0.35;
    const conf = {
        fullName: heuristic.fullName ? lowConf : 0,
        nationality: heuristic.nationality ? lowConf : 0,
        dateOfBirth: heuristic.dateOfBirth ? lowConf : 0,
        documentNumber: heuristic.documentNumber ? lowConf : 0,
        expiryDate: heuristic.expiryDate ? lowConf : 0,
        issuingCountry: heuristic.issuingCountry ? lowConf : 0,
        overall: hasAnyField ? lowConf : 0,
    };
    return {
        ok: hasAnyField,
        rawFields,
        maskedFields: maskFields(rawFields),
        confidences: conf,
        validation: { mrzFound: false, mrzFormat: 'UNKNOWN', mrzChecksumPassed: false, failedChecksums: [], errors },
        errors,
    };
}
//# sourceMappingURL=passport.js.map