"use strict";
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
exports.rugImagePathToPublicUrl = rugImagePathToPublicUrl;
exports.fetchPrimaryRugImagesForRugs = fetchPrimaryRugImagesForRugs;
var RUG_IMAGES_BUCKET = "rug-images";
function normalizeStoragePath(path) {
    if (typeof path !== "string")
        return null;
    var normalized = path.trim().replace(/^\/+/, "");
    return normalized.length > 0 ? normalized : null;
}
function rugImagePathToPublicUrl(supabase, path) {
    var normalizedPath = normalizeStoragePath(path);
    if (!normalizedPath)
        return null;
    var data = supabase.storage
        .from(RUG_IMAGES_BUCKET)
        .getPublicUrl(normalizedPath).data;
    return typeof data.publicUrl === "string" && data.publicUrl.length > 0
        ? data.publicUrl
        : null;
}
function fetchPrimaryRugImagesForRugs(input) {
    return __awaiter(this, void 0, void 0, function () {
        var map, uniqueRugIds, _a, data, error, selectedByRug, _i, data_1, row, candidate, imageRow, _b, _c, _d, rugId, row;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    map = new Map();
                    if (input.rugIds.length === 0)
                        return [2 /*return*/, map];
                    uniqueRugIds = __spreadArray([], new Set(input.rugIds), true).filter(function (id) { return typeof id === "string" && id.trim().length > 0; });
                    if (uniqueRugIds.length === 0)
                        return [2 /*return*/, map];
                    return [4 /*yield*/, input.supabase
                            .from("rug_images")
                            .select("rug_id, path")
                            .eq("tenant_id", input.tenantId)
                            .in("rug_id", uniqueRugIds)];
                case 1:
                    _a = _e.sent(), data = _a.data, error = _a.error;
                    if (error || !Array.isArray(data)) {
                        return [2 /*return*/, map];
                    }
                    selectedByRug = new Map();
                    for (_i = 0, data_1 = data; _i < data_1.length; _i++) {
                        row = data_1[_i];
                        if (!row || typeof row !== "object")
                            continue;
                        candidate = row;
                        if (typeof candidate.rug_id !== "string")
                            continue;
                        imageRow = {
                            rug_id: candidate.rug_id,
                            path: typeof candidate.path === "string" ? candidate.path : null,
                        };
                        if (!normalizeStoragePath(imageRow.path))
                            continue;
                        // MVP assumption: unique rug_id in rug_images, so first valid row wins.
                        if (selectedByRug.has(imageRow.rug_id))
                            continue;
                        selectedByRug.set(imageRow.rug_id, imageRow);
                    }
                    for (_b = 0, _c = selectedByRug.entries(); _b < _c.length; _b++) {
                        _d = _c[_b], rugId = _d[0], row = _d[1];
                        map.set(rugId, {
                            primary_image_url: rugImagePathToPublicUrl(input.supabase, row.path),
                            // Caption column is optional in current MVP schema usage.
                            primary_image_caption: null,
                        });
                    }
                    return [2 /*return*/, map];
            }
        });
    });
}
