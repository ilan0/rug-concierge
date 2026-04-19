#!/usr/bin/env tsx
"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
var node_crypto_1 = require("node:crypto");
var node_fs_1 = require("node:fs");
var node_path_1 = require("node:path");
var supabase_js_1 = require("@supabase/supabase-js");
var rug_images_1 = require("../../apps/web/lib/storage/rug-images");
var DEMO_TENANT_ID = "d0d97eca-5384-4f35-a970-db7031c188b0";
var GEMINI_GENERATE_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent";
var DEFAULT_LIMIT = 15;
var ENHANCEMENT_MODEL = "gemini-2.5-flash-image";
var ENHANCEMENT_VARIANT = "default";
var ENHANCEMENT_SIZE = "native";
var ENHANCEMENT_OUTPUT_FORMAT = "native";
var API_REQUEST_TIMEOUT_MS = 120000;
var FILE_DOWNLOAD_TIMEOUT_MS = 60000;
var MAX_ENHANCEMENT_ATTEMPTS = 2;
var ENHANCEMENT_PROMPT = [
    "Create a premium e-commerce presentation image of this exact rug using one consistent standardized background.",
    "Use this exact background style every time: a clean light natural white-oak hardwood floor with a matte finish, wide planks, soft diffuse daylight, and a subtle natural contact shadow around the rug. No furniture, no decor, no walls, no styling objects, and no other rugs.",
    "This is a rug-preservation task. The rug must remain the exact same physical rug with all original details intact.",
    "Preserve exactly: colors and tonal character, pattern and small motifs, border design, fringe shape and irregularities, wear, pile variation, asymmetry, imperfections, rug proportions, and rug outline.",
    "Required composition: show only one rug, center the rug cleanly in frame, keep the full rug visible including all fringe, and use a calm top-down merchandising presentation.",
    "Remove distracting store background outside the rug. If another rug, fringe, foot, furniture edge, tape, or object is visible around or under the main rug, remove it and replace only that non-rug area with the standardized oak floor.",
    "If part of the rug is cropped, cut off, blocked, folded under another rug, or partially hidden, reconstruct only the missing rug area as faithfully as possible using the visible rug pattern, border structure, colors, fringe, and symmetry already present in the image.",
    "Only complete missing rug areas when the continuation is strongly supported by the visible rug. The reconstructed area must match the existing rug exactly in style, wear, texture, tonal character, and level of detail.",
    "Do not change the rug's color, lighting, exposure, white balance, contrast, saturation, texture, sharpness, or detail.",
    "Do not simplify, redraw, smooth, sharpen, repair, clean up, or invent motifs or ornament details outside the minimum faithful completion needed for truly missing rug areas.",
    "Do not crop off fringe.",
    "Do not leave remnants of another rug under the main rug.",
    "Do not create a lifestyle room scene.",
    "Do not make the rug look newer, cleaner, flatter, or more luxurious than it really is.",
    "The result should look like the same real rug professionally staged on the same premium oak floor used for the entire catalog.",
].join(" ");
function usage() {
    console.error([
        "Usage:",
        "  npm exec tsx -- scripts/testing/gemini-rug-enhancement.ts [--limit <n>] [--out-dir <dir>] [--dry-run]",
    ].join("\n"));
    process.exit(1);
}
function parsePositiveInt(value, flag) {
    var parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error("".concat(flag, " must be a positive integer."));
    }
    return parsed;
}
function parseArgs(argv) {
    var options = {
        limit: DEFAULT_LIMIT,
        outDir: null,
        dryRun: false,
    };
    for (var index = 0; index < argv.length; index += 1) {
        var arg = argv[index];
        if (arg === "--dry-run") {
            options.dryRun = true;
            continue;
        }
        if (arg === "--limit") {
            var next = argv[index + 1];
            if (!next)
                usage();
            options.limit = parsePositiveInt(next, "--limit");
            index += 1;
            continue;
        }
        if (arg === "--out-dir") {
            var next = argv[index + 1];
            if (!next)
                usage();
            options.outDir = next.trim();
            index += 1;
            continue;
        }
        throw new Error("Unknown argument: ".concat(arg));
    }
    return options;
}
function loadEnvFileIfExists(filePath) {
    if (!node_fs_1.default.existsSync(filePath))
        return;
    var content = node_fs_1.default.readFileSync(filePath, "utf8");
    for (var _i = 0, _a = content.split(/\r?\n/); _i < _a.length; _i++) {
        var rawLine = _a[_i];
        var line = rawLine.trim();
        if (!line || line.startsWith("#"))
            continue;
        var equalsIndex = line.indexOf("=");
        if (equalsIndex <= 0)
            continue;
        var key = line.slice(0, equalsIndex).trim();
        var value = line.slice(equalsIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (!(key in process.env)) {
            process.env[key] = value;
        }
    }
}
function loadEnv() {
    var root = process.cwd();
    loadEnvFileIfExists(node_path_1.default.join(root, ".env.local"));
    loadEnvFileIfExists(node_path_1.default.join(root, "apps/web/.env.local"));
}
function readRequiredEnv(name) {
    var value = process.env[name];
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error("Missing required env var: ".concat(name));
    }
    return value.trim();
}
function nowStamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
}
function ensureDir(dirPath) {
    node_fs_1.default.mkdirSync(dirPath, { recursive: true });
}
function withTimeout(url, options, timeoutMs) {
    var controller = new AbortController();
    var timer = setTimeout(function () { return controller.abort(); }, timeoutMs);
    return fetch(url, __assign(__assign({}, options), { signal: controller.signal })).finally(function () {
        return clearTimeout(timer);
    });
}
function sha256(value) {
    return (0, node_crypto_1.createHash)("sha256").update(value).digest("hex");
}
function toSafeBasename(value, fallback) {
    var source = (value !== null && value !== void 0 ? value : fallback).trim();
    var safe = source.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
    return safe.length > 0 ? safe : fallback;
}
function extFromContentType(contentType) {
    var normalized = (contentType !== null && contentType !== void 0 ? contentType : "").toLowerCase();
    if (normalized.includes("image/jpeg"))
        return ".jpg";
    if (normalized.includes("image/png"))
        return ".png";
    if (normalized.includes("image/webp"))
        return ".webp";
    return ".img";
}
function extractInlineData(block) {
    var camel = block.inlineData;
    if (camel && typeof camel === "object") {
        return camel;
    }
    var snake = block.inline_data;
    if (snake && typeof snake === "object") {
        return snake;
    }
    return null;
}
function parseGeminiImageResponse(response, payload) {
    var _a, _b, _c;
    if (!response.ok) {
        var message = payload && typeof payload === "object" && "error" in payload
            ? String((_b = (_a = payload.error) === null || _a === void 0 ? void 0 : _a.message) !== null && _b !== void 0 ? _b : "Gemini image request failed.")
            : "Gemini image request failed.";
        throw new Error("Gemini image request failed (".concat(response.status, "): ").concat(message));
    }
    if (!payload || typeof payload !== "object") {
        throw new Error("Gemini image response missing payload.");
    }
    var candidates = payload.candidates;
    if (!Array.isArray(candidates)) {
        throw new Error("Gemini image response missing candidates.");
    }
    for (var _i = 0, candidates_1 = candidates; _i < candidates_1.length; _i++) {
        var candidate = candidates_1[_i];
        if (!candidate || typeof candidate !== "object")
            continue;
        var content = candidate.content;
        if (!content || typeof content !== "object")
            continue;
        var parts = content.parts;
        if (!Array.isArray(parts))
            continue;
        for (var _d = 0, parts_1 = parts; _d < parts_1.length; _d++) {
            var part = parts_1[_d];
            if (!part || typeof part !== "object")
                continue;
            var inline = extractInlineData(part);
            if (!inline)
                continue;
            var data = inline.data;
            if (typeof data !== "string" || data.trim().length === 0)
                continue;
            var mimeTypeValue = (_c = inline.mimeType) !== null && _c !== void 0 ? _c : inline.mime_type;
            var contentType = typeof mimeTypeValue === "string" && mimeTypeValue.trim().length > 0
                ? mimeTypeValue
                : "image/png";
            return {
                buffer: Buffer.from(data, "base64"),
                contentType: contentType,
            };
        }
    }
    throw new Error("Gemini image response did not include inline image data.");
}
function isRetryableEnhancementError(message) {
    return (message.includes("(429)") ||
        message.includes("(500)") ||
        message.includes("(502)") ||
        message.includes("(503)") ||
        message.includes("(504)") ||
        message.includes("AbortError") ||
        message.toLowerCase().includes("timed out"));
}
function createSupabase() {
    var supabaseUrl = readRequiredEnv("SUPABASE_URL");
    var supabaseSecret = readRequiredEnv("SUPABASE_SECRET_KEY");
    return (0, supabase_js_1.createClient)(supabaseUrl, supabaseSecret, {
        auth: { persistSession: false },
    });
}
function listDemoRugs(supabase, limit) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, data, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, supabase
                        .from("rugs")
                        .select("id, stock_id, intake_label")
                        .eq("tenant_id", DEMO_TENANT_ID)
                        .eq("status", "available")
                        .eq("enrichment_status", "ready")
                        .order("stock_id", { ascending: true })
                        .order("id", { ascending: true })
                        .limit(limit)];
                case 1:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error) {
                        throw new Error("Failed to load demo rugs: ".concat(error.message));
                    }
                    return [2 /*return*/, (Array.isArray(data) ? data : []).filter(function (row) {
                            return Boolean(row &&
                                typeof row === "object" &&
                                typeof row.id === "string");
                        })];
            }
        });
    });
}
function listRugImages(supabase, rugIds) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, data, error, map, _i, _b, row, typed;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    if (rugIds.length === 0)
                        return [2 /*return*/, new Map()];
                    return [4 /*yield*/, supabase
                            .from("rug_images")
                            .select("rug_id, path")
                            .eq("tenant_id", DEMO_TENANT_ID)
                            .in("rug_id", rugIds)];
                case 1:
                    _a = _c.sent(), data = _a.data, error = _a.error;
                    if (error) {
                        throw new Error("Failed to load rug images: ".concat(error.message));
                    }
                    map = new Map();
                    for (_i = 0, _b = Array.isArray(data) ? data : []; _i < _b.length; _i++) {
                        row = _b[_i];
                        if (row &&
                            typeof row === "object" &&
                            typeof row.rug_id === "string" &&
                            typeof row.path === "string") {
                            typed = row;
                            if (!map.has(typed.rug_id)) {
                                map.set(typed.rug_id, {
                                    rug_id: typed.rug_id,
                                    path: typed.path,
                                });
                            }
                        }
                    }
                    return [2 /*return*/, map];
            }
        });
    });
}
function downloadOriginalImage(supabase, storagePath) {
    return __awaiter(this, void 0, void 0, function () {
        var publicUrl, response, text, contentType, _a, _b;
        var _c;
        var _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    publicUrl = (0, rug_images_1.rugImagePathToPublicUrl)(supabase, storagePath);
                    if (!publicUrl) {
                        throw new Error("Unable to resolve public URL for storage path.");
                    }
                    return [4 /*yield*/, withTimeout(publicUrl, {
                            method: "GET",
                        }, FILE_DOWNLOAD_TIMEOUT_MS)];
                case 1:
                    response = _e.sent();
                    if (!!response.ok) return [3 /*break*/, 3];
                    return [4 /*yield*/, response.text().catch(function () { return ""; })];
                case 2:
                    text = _e.sent();
                    throw new Error("Original image download failed (".concat(response.status, "): ").concat(text.slice(0, 240)));
                case 3:
                    contentType = (_d = response.headers.get("content-type")) !== null && _d !== void 0 ? _d : "application/octet-stream";
                    _c = {
                        publicUrl: publicUrl,
                        storagePath: storagePath,
                        contentType: contentType,
                        extension: extFromContentType(contentType)
                    };
                    _b = (_a = Buffer).from;
                    return [4 /*yield*/, response.arrayBuffer()];
                case 4: return [2 /*return*/, (_c.buffer = _b.apply(_a, [_e.sent()]),
                        _c)];
            }
        });
    });
}
function requestEnhancement(input) {
    return __awaiter(this, void 0, void 0, function () {
        var startedAt, attempts, lastError, requestPayload, response, payload, parsed, error_1, nextError;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    startedAt = Date.now();
                    attempts = 0;
                    lastError = null;
                    _a.label = 1;
                case 1:
                    if (!(attempts < MAX_ENHANCEMENT_ATTEMPTS)) return [3 /*break*/, 7];
                    attempts += 1;
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 5, , 6]);
                    requestPayload = {
                        contents: [
                            {
                                parts: [
                                    { text: ENHANCEMENT_PROMPT },
                                    {
                                        inline_data: {
                                            mime_type: input.image.contentType,
                                            data: input.image.buffer.toString("base64"),
                                        },
                                    },
                                ],
                            },
                        ],
                        generationConfig: {
                            responseModalities: ["Image"],
                        },
                    };
                    return [4 /*yield*/, withTimeout(GEMINI_GENERATE_URL, {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "x-goog-api-key": input.apiKey,
                            },
                            body: JSON.stringify(requestPayload),
                        }, API_REQUEST_TIMEOUT_MS)];
                case 3:
                    response = _a.sent();
                    return [4 /*yield*/, response.json().catch(function () { return null; })];
                case 4:
                    payload = (_a.sent());
                    parsed = parseGeminiImageResponse(response, payload);
                    return [2 /*return*/, {
                            buffer: parsed.buffer,
                            contentType: parsed.contentType,
                            attempts: attempts,
                            timingMs: Date.now() - startedAt,
                        }];
                case 5:
                    error_1 = _a.sent();
                    nextError = error_1 instanceof Error ? error_1 : new Error("Unknown enhancement error.");
                    lastError = nextError;
                    if (attempts >= MAX_ENHANCEMENT_ATTEMPTS || !isRetryableEnhancementError(nextError.message)) {
                        return [3 /*break*/, 7];
                    }
                    return [3 /*break*/, 6];
                case 6: return [3 /*break*/, 1];
                case 7: throw lastError !== null && lastError !== void 0 ? lastError : new Error("Enhancement failed.");
            }
        });
    });
}
function defaultOutputDir() {
    return node_path_1.default.join(process.cwd(), "tmp", "gemini-rug-enhancement", nowStamp());
}
function writeJson(filePath, value) {
    node_fs_1.default.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}
function buildManifest(options) {
    return {
        generated_at: new Date().toISOString(),
        tenant_id: DEMO_TENANT_ID,
        limit: options.limit,
        dry_run: options.dryRun,
        enhancement_model: ENHANCEMENT_MODEL,
        enhancement_quality: ENHANCEMENT_VARIANT,
        enhancement_prompt_hash: sha256(ENHANCEMENT_PROMPT),
        entries: [],
    };
}
function writeReviewFiles(outDir, manifest) {
    var summary = {
        total: manifest.entries.length,
        enhanced_success: manifest.entries.filter(function (entry) { return entry.enhancement.status === "success"; }).length,
        enhancement_error: manifest.entries.filter(function (entry) { return entry.enhancement.status === "error"; }).length,
    };
    var reviewMd = __spreadArray(__spreadArray([
        "# Gemini Rug Enhancement Review",
        "",
        "Generated: ".concat(manifest.generated_at),
        "Tenant: ".concat(manifest.tenant_id),
        "Total rugs: ".concat(summary.total),
        "Enhancement success: ".concat(summary.enhanced_success),
        "Enhancement errors: ".concat(summary.enhancement_error),
        "",
        "| Stock ID | Label | Enhancement | Notes |",
        "| --- | --- | --- | --- |"
    ], manifest.entries.map(function (entry) {
        var _a, _b, _c;
        var notes = (_a = entry.enhancement.error) !== null && _a !== void 0 ? _a : "";
        return "| ".concat((_b = entry.stock_id) !== null && _b !== void 0 ? _b : entry.rug_id, " | ").concat((_c = entry.intake_label) !== null && _c !== void 0 ? _c : "", " | ").concat(entry.enhancement.status, " | ").concat(notes.replace(/\|/g, "\\|"), " |");
    }), true), [
        "",
    ], false).join("\n");
    node_fs_1.default.writeFileSync(node_path_1.default.join(outDir, "review.md"), reviewMd);
    var cards = manifest.entries
        .map(function (entry) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        var originalPath = entry.original.local_path
            ? node_path_1.default.relative(outDir, node_path_1.default.resolve(process.cwd(), entry.original.local_path))
            : null;
        var enhancedPath = entry.enhancement.local_path
            ? node_path_1.default.relative(outDir, node_path_1.default.resolve(process.cwd(), entry.enhancement.local_path))
            : null;
        var verdict = (_b = (_a = entry.qa.result) === null || _a === void 0 ? void 0 : _a.verdict) !== null && _b !== void 0 ? _b : entry.qa.status;
        var notes = (_f = (_e = (_d = (_c = entry.qa.result) === null || _c === void 0 ? void 0 : _c.notes) !== null && _d !== void 0 ? _d : entry.qa.error) !== null && _e !== void 0 ? _e : entry.enhancement.error) !== null && _f !== void 0 ? _f : "";
        return "\n        <article class=\"card\">\n          <header>\n            <h2>".concat(escapeHtml((_g = entry.stock_id) !== null && _g !== void 0 ? _g : entry.rug_id), "</h2>\n            <p>").concat(escapeHtml((_h = entry.intake_label) !== null && _h !== void 0 ? _h : ""), "</p>\n            <span class=\"badge badge-").concat(escapeHtml(entry.enhancement.status), "\">").concat(escapeHtml(entry.enhancement.status), "</span>\n          </header>\n          <div class=\"images\">\n            <figure>\n              <figcaption>Original</figcaption>\n              ").concat(originalPath
            ? "<img src=\"".concat(escapeHtml(originalPath), "\" alt=\"Original rug photo for ").concat(escapeHtml((_j = entry.stock_id) !== null && _j !== void 0 ? _j : entry.rug_id), "\">")
            : "<div class=\"missing\">Missing original</div>", "\n            </figure>\n            <figure>\n              <figcaption>Enhanced</figcaption>\n              ").concat(enhancedPath
            ? "<img src=\"".concat(escapeHtml(enhancedPath), "\" alt=\"Enhanced rug photo for ").concat(escapeHtml((_k = entry.stock_id) !== null && _k !== void 0 ? _k : entry.rug_id), "\">")
            : "<div class=\"missing\">Enhancement failed</div>", "\n            </figure>\n          </div>\n          <dl>\n            <div><dt>Enhancement</dt><dd>").concat(escapeHtml(entry.enhancement.status), "</dd></div>\n            <div><dt>Notes</dt><dd>").concat(escapeHtml(entry.enhancement.error || "Manual review"), "</dd></div>\n          </dl>\n        </article>\n      ");
    })
        .join("\n");
    var html = "<!doctype html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n  <title>Gemini Rug Enhancement Review</title>\n  <style>\n    body { font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif; background: #f6f1ea; color: #2f241a; margin: 0; padding: 24px; }\n    h1 { margin: 0 0 8px; }\n    p.meta { margin: 0 0 24px; color: #6c5a49; }\n    .grid { display: grid; gap: 20px; }\n    .card { background: #fffaf4; border: 1px solid #decfb9; border-radius: 18px; padding: 18px; box-shadow: 0 10px 24px rgba(47, 36, 26, 0.06); }\n    .card header { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; margin-bottom: 14px; }\n    .card h2 { margin: 0; font-size: 18px; }\n    .card p { margin: 0; color: #6c5a49; }\n    .images { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }\n    figure { margin: 0; }\n    figcaption { margin-bottom: 6px; font-size: 13px; color: #6c5a49; }\n    img { width: 100%; background: #f3ebdd; border-radius: 12px; border: 1px solid #decfb9; }\n    .missing { min-height: 220px; display: grid; place-items: center; border-radius: 12px; border: 1px dashed #decfb9; background: #f8f4ee; color: #6c5a49; }\n    dl { margin: 0; display: grid; gap: 8px; }\n    dl div { display: grid; grid-template-columns: 120px 1fr; gap: 10px; }\n    dt { font-weight: 600; }\n    dd { margin: 0; color: #6c5a49; }\n    .badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }\n    .badge-pass { background: #e7f4ea; color: #205b31; }\n    .badge-borderline { background: #f9f0d8; color: #7c5c10; }\n    .badge-fail, .badge-error { background: #f7e7e5; color: #8b2d1f; }\n    .badge-skipped, .badge-pending { background: #ece7df; color: #5a4b3e; }\n  </style>\n</head>\n<body>\n  <h1>Gemini Rug Enhancement Review</h1>\n  <p class=\"meta\">Generated ".concat(escapeHtml(manifest.generated_at), " \u00B7 ").concat(manifest.entries.length, " rugs \u00B7 enhancement model ").concat(escapeHtml(manifest.enhancement_model), " (").concat(escapeHtml(manifest.enhancement_quality), ")</p>\n  <section class=\"grid\">").concat(cards, "</section>\n</body>\n</html>");
    node_fs_1.default.writeFileSync(node_path_1.default.join(outDir, "index.html"), html);
}
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var options, geminiApiKey, supabase, outDir, manifest, rugs, rugImages, _i, rugs_1, rug, image, _a, rugs_2, rug, imageRow, fileStem, entry, original, originalPath, enhancement, enhancedExtension, enhancedPath, error_2, message;
        var _b, _c, _d, _e, _f;
        return __generator(this, function (_g) {
            switch (_g.label) {
                case 0:
                    loadEnv();
                    options = parseArgs(process.argv.slice(2));
                    geminiApiKey = readRequiredEnv("GEMINI_API_KEY");
                    supabase = createSupabase();
                    outDir = options.outDir
                        ? node_path_1.default.resolve(process.cwd(), options.outDir)
                        : defaultOutputDir();
                    manifest = buildManifest(options);
                    return [4 /*yield*/, listDemoRugs(supabase, options.limit)];
                case 1:
                    rugs = _g.sent();
                    return [4 /*yield*/, listRugImages(supabase, rugs.map(function (rug) { return rug.id; }))];
                case 2:
                    rugImages = _g.sent();
                    console.log("[gemini-rug-enhancement] Demo tenant ".concat(DEMO_TENANT_ID, ": found ").concat(rugs.length, " candidate rugs."));
                    if (options.dryRun) {
                        console.log("[gemini-rug-enhancement] Dry run only. Planned output dir: ".concat(outDir));
                        console.log("[gemini-rug-enhancement] Enhancement: ".concat(ENHANCEMENT_MODEL, " (").concat(ENHANCEMENT_VARIANT, ")"));
                        for (_i = 0, rugs_1 = rugs; _i < rugs_1.length; _i++) {
                            rug = rugs_1[_i];
                            image = rugImages.get(rug.id);
                            console.log("- ".concat((_b = rug.stock_id) !== null && _b !== void 0 ? _b : rug.id, " :: ").concat((_c = rug.intake_label) !== null && _c !== void 0 ? _c : "(untitled)", " :: ").concat((_d = image === null || image === void 0 ? void 0 : image.path) !== null && _d !== void 0 ? _d : "missing image"));
                        }
                        return [2 /*return*/];
                    }
                    ensureDir(outDir);
                    ensureDir(node_path_1.default.join(outDir, "originals"));
                    ensureDir(node_path_1.default.join(outDir, "enhanced"));
                    ensureDir(node_path_1.default.join(outDir, "qa"));
                    _a = 0, rugs_2 = rugs;
                    _g.label = 3;
                case 3:
                    if (!(_a < rugs_2.length)) return [3 /*break*/, 10];
                    rug = rugs_2[_a];
                    imageRow = rugImages.get(rug.id);
                    fileStem = toSafeBasename(rug.stock_id, rug.id);
                    entry = {
                        rug_id: rug.id,
                        stock_id: rug.stock_id,
                        intake_label: rug.intake_label,
                        original: {
                            storage_path: (_e = imageRow === null || imageRow === void 0 ? void 0 : imageRow.path) !== null && _e !== void 0 ? _e : null,
                            public_url: null,
                            local_path: null,
                            content_type: null,
                            download_status: "pending",
                            error: null,
                        },
                        enhancement: {
                            model: ENHANCEMENT_MODEL,
                            quality: ENHANCEMENT_VARIANT,
                            size: ENHANCEMENT_SIZE,
                            output_format: ENHANCEMENT_OUTPUT_FORMAT,
                            prompt_hash: sha256(ENHANCEMENT_PROMPT),
                            local_path: null,
                            status: "pending",
                            timing_ms: null,
                            attempts: 0,
                            error: null,
                        },
                    };
                    manifest.entries.push(entry);
                    if (!(imageRow === null || imageRow === void 0 ? void 0 : imageRow.path)) {
                        entry.original.download_status = "error";
                        entry.original.error = "Primary image path missing.";
                        entry.enhancement.status = "error";
                        entry.enhancement.error = "Skipped because primary image path is missing.";
                        writeJson(node_path_1.default.join(outDir, "manifest.json"), manifest);
                        return [3 /*break*/, 9];
                    }
                    _g.label = 4;
                case 4:
                    _g.trys.push([4, 7, , 8]);
                    return [4 /*yield*/, downloadOriginalImage(supabase, imageRow.path)];
                case 5:
                    original = _g.sent();
                    originalPath = node_path_1.default.join(outDir, "originals", "".concat(fileStem).concat(original.extension));
                    node_fs_1.default.writeFileSync(originalPath, original.buffer);
                    entry.original.public_url = original.publicUrl;
                    entry.original.local_path = node_path_1.default.relative(process.cwd(), originalPath);
                    entry.original.content_type = original.contentType;
                    entry.original.download_status = "success";
                    return [4 /*yield*/, requestEnhancement({
                            apiKey: geminiApiKey,
                            image: original,
                        })];
                case 6:
                    enhancement = _g.sent();
                    enhancedExtension = extFromContentType(enhancement.contentType);
                    enhancedPath = node_path_1.default.join(outDir, "enhanced", "".concat(fileStem).concat(enhancedExtension));
                    node_fs_1.default.writeFileSync(enhancedPath, enhancement.buffer);
                    entry.enhancement.local_path = node_path_1.default.relative(process.cwd(), enhancedPath);
                    entry.enhancement.status = "success";
                    entry.enhancement.timing_ms = enhancement.timingMs;
                    entry.enhancement.attempts = enhancement.attempts;
                    entry.enhancement.output_format = enhancement.contentType;
                    return [3 /*break*/, 8];
                case 7:
                    error_2 = _g.sent();
                    message = error_2 instanceof Error ? error_2.message : "Unknown enhancement failure.";
                    if (entry.original.download_status === "pending") {
                        entry.original.download_status = "error";
                        entry.original.error = message;
                    }
                    entry.enhancement.status = "error";
                    entry.enhancement.error = message;
                    return [3 /*break*/, 8];
                case 8:
                    writeJson(node_path_1.default.join(outDir, "manifest.json"), manifest);
                    console.log("[gemini-rug-enhancement] ".concat((_f = rug.stock_id) !== null && _f !== void 0 ? _f : rug.id, ": enhancement=").concat(entry.enhancement.status));
                    _g.label = 9;
                case 9:
                    _a++;
                    return [3 /*break*/, 3];
                case 10:
                    writeReviewFiles(outDir, manifest);
                    console.log("[gemini-rug-enhancement] Artifacts written to ".concat(outDir));
                    return [2 /*return*/];
            }
        });
    });
}
main().catch(function (error) {
    console.error(error instanceof Error ? error.message : "Unknown script error.");
    process.exitCode = 1;
});
