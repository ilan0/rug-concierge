#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const WEB_ENV_PATH = path.join(ROOT, 'apps/web/.env.local');
const WORK_ROOT = path.join(
  ROOT,
  'apps/site/public/media/source/generated-marketing'
);
const MANIFEST_PATH = path.join(WORK_ROOT, 'manifest.json');
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const OPENAI_EDITS_URL = 'https://api.openai.com/v1/images/edits';
const MODEL = process.env.OPENAI_IMAGE_MODEL?.trim() || 'gpt-image-1.5';
const QUALITY = process.env.OPENAI_IMAGE_QUALITY?.trim() || 'high';
const BACKGROUND = 'auto';
const MODERATION = 'low';
const OUTPUT_FORMAT = 'webp';
const GENERATION_TIMEOUT_MS = 120_000;
const URL_FETCH_TIMEOUT_MS = 60_000;
const ACCEPTED_TARGETS = new Set([
  'hero',
  'inventory-before',
  'inventory-after',
  'saved-rugs',
  'follow-up',
]);

const FINAL_PATHS = {
  hero: 'apps/site/public/media/hero/hero-composite.webp',
  'inventory-before': 'apps/site/public/media/inventory/intake-before.webp',
  'inventory-after': 'apps/site/public/media/inventory/intake-after.webp',
  'saved-rugs': 'apps/site/public/media/product/saved-rugs.webp',
  'follow-up': 'apps/site/public/media/product/follow-up.webp',
};

const TARGET_SPECS = {
  hero: {
    size: '1536x1024',
    mode: 'generate',
    prompts: [
      `Use case: photorealistic-natural
Asset type: landing page hero image for a luxury rug retail software company
Primary request: create a premium photorealistic showroom scene for a rug business website.
Scene/backdrop: rich traditional rug showroom interior, warm wood tones, layered Persian and vintage rugs, elegant depth, natural premium lighting, no visible exterior windows dominating the scene.
Subject: a landscape tablet placed naturally in the showroom scene, clearly visible but integrated elegantly. The tablet screen shows a believable rug concierge product with one short customer message and matching rug results visible at the same time.
Style/medium: high-end editorial interior photography, luxurious but practical, realistic textile detail.
Composition/framing: wide cinematic composition with strong negative space for headline and CTA on one side, tablet on the opposite side, desktop-hero friendly.
Lighting/mood: warm, calm, expensive, trustworthy.
Color palette: amber wood, cream, rust, navy, soft gold, natural textile colors.
Materials/textures: real woven fibers, carved wood, stacked rugs, matte tablet glass.
Text (verbatim): ""
Constraints: no clear people, no faces, no logos, no watermark, no floating holograms, no corporate office, no generic SaaS dashboard, no purple palette, no broken rug symmetry, minimal text on the device screen.
Avoid: cheesy stock-photo energy, futuristic AI motifs, clutter, warped textile geometry, unreadable microcopy.`,
      `Use case: photorealistic-natural
Asset type: landing page hero image for a luxury rug retail software company
Primary request: create a premium photorealistic showroom scene that immediately communicates premium rug retail and real product proof.
Scene/backdrop: traditional high-end rug showroom with warm wood shelving, layered oriental rugs, elegant density, authentic merchandise presentation.
Subject: one landscape tablet, placed naturally on a stand or tabletop, screen angled toward the viewer. The screen shows a clean chat-and-results concierge moment with a short customer request and two or three rug matches, but text remains secondary.
Style/medium: luxury editorial photography, not illustration.
Composition/framing: strong left-right composition with generous copy space, clearer focal separation between room and device, no clutter.
Lighting/mood: warm directional light, calm, upscale, believable.
Constraints: no people, no logos, no dashboard UI, no glowing effects, no messy device text, no warped rugs.
Avoid: startup office aesthetics, sterile minimalism, exaggerated perspective, fake CGI look.`,
      `Use case: photorealistic-natural
Asset type: landing page hero image for a luxury rug retail software company
Primary request: create a simplified premium showroom hero scene that feels instantly understandable and luxurious.
Scene/backdrop: one refined traditional rug showroom with fewer objects, layered rugs, warm wood, premium calm atmosphere.
Subject: one landscape tablet showing chat plus rug matches in a simple believable interface.
Style/medium: photoreal editorial interior shot.
Composition/framing: simplified wide hero, tablet clearly readable, strong negative space for marketing copy.
Lighting/mood: soft warm light, premium, calm.
Constraints: no people, no logos, no dashboard, minimal on-screen text, no visual clutter, no textile distortion.
Avoid: overly busy room, decorative gimmicks, futuristic effects, cheap stock-photo look.`,
      `Use case: photorealistic-natural
Asset type: landing page hero image for a luxury rug retail software company
Primary request: create an exceptionally realistic premium showroom hero scene with flawless rug texture and believable merchandising.
Scene/backdrop: authentic traditional rug showroom with rich wood, stacked rugs, elegant spacing, deep texture.
Subject: one landscape tablet naturally placed in the scene, screen visible with a tasteful concierge chat plus rug matches interface.
Style/medium: extremely realistic editorial photography with precise textile rendering.
Composition/framing: wide cinematic, room first but product still obvious, clean copy space.
Lighting/mood: warm and refined, not dramatic or moody.
Constraints: no people, no brand marks, no AI glow, no distorted rug patterns, no uncanny interface, minimal text.
Avoid: painterly look, over-sharpening, synthetic fibers, warped edges, cheesy ad styling.`,
      `Use case: photorealistic-natural
Asset type: landing page hero image for a luxury rug retail software company
Primary request: create the cleanest and strongest possible premium rug showroom hero image.
Scene/backdrop: refined traditional rug showroom with warm wood and layered rugs only where needed.
Subject: one landscape tablet showing a minimal concierge chat plus matching rugs.
Style/medium: photorealistic editorial business image.
Composition/framing: narrowed to a single strong hero frame with obvious copy space and one clear focal point.
Lighting/mood: warm, elegant, trustworthy.
Constraints: no people, no logos, no clutter, no dashboard complexity, minimal device text, perfect rug geometry.
Avoid: busy compositions, decorative excess, generic tech startup vibe, visual confusion.`
    ]
  },
  'inventory-before': {
    size: '1536x1024',
    mode: 'generate',
    prompts: [
      `Use case: photorealistic-natural
Asset type: homepage section image for inventory intake workflow
Primary request: create a believable rough phone photo of a rug taken quickly on a showroom floor.
Scene/backdrop: real in-store rug showroom floor, some surrounding floor visible, practical in-store environment.
Subject: one premium rug photographed imperfectly but realistically, as if a staff member quickly snapped it for intake.
Style/medium: realistic phone-camera photography.
Composition/framing: slightly crooked angle, mildly uneven framing, enough surrounding context to show it was a quick in-store capture.
Lighting/mood: practical showroom lighting, a little imperfect but still believable.
Color palette: natural rug colors, warm showroom neutrals.
Materials/textures: authentic woven rug texture and realistic floor surface.
Text (verbatim): ""
Constraints: no people, no visible hands, no absurd mess, no intentional ugliness, no cut-off rug so severe it feels broken, no watermark.
Avoid: polished catalog look, studio background, fake AI sparkle, dramatic shadows, warped rug geometry.`,
      `Use case: photorealistic-natural
Asset type: homepage section image for inventory intake workflow
Primary request: create a more obviously quick in-store rug intake photo while staying realistic and credible.
Scene/backdrop: showroom floor with subtle surrounding context.
Subject: one high-end rug captured at a slightly imperfect phone angle with small framing mistakes.
Style/medium: believable smartphone photo.
Composition/framing: rug mostly visible, mildly off-center, practical intake shot.
Lighting/mood: uneven but natural store lighting.
Constraints: no people, no hands, no clutter pile, no broken rug shape, no studio polish.
Avoid: catalog perfection, extreme sloppiness, warped pattern geometry, fake textures.`,
      `Use case: photorealistic-natural
Asset type: homepage section image for inventory intake workflow
Primary request: simplify the intake photo so the rug and its quick-capture imperfections are immediately readable.
Scene/backdrop: simple showroom floor only.
Subject: one rug photographed quickly in store.
Style/medium: realistic phone photo.
Composition/framing: easy to read, slight tilt, slightly imperfect framing, no extra distractions.
Lighting/mood: practical ambient light.
Constraints: no people, no busy background, no studio effect.
Avoid: confusion, excess clutter, broken edges, synthetic textile detail.`,
      `Use case: photorealistic-natural
Asset type: homepage section image for inventory intake workflow
Primary request: create an exceptionally realistic in-store rug intake photo with convincing phone-camera imperfections.
Scene/backdrop: actual showroom flooring and retail context kept subtle.
Subject: one traditional premium rug captured quickly for inventory intake.
Style/medium: highly realistic smartphone photograph.
Composition/framing: slightly skewed but still useful, immediate readability.
Lighting/mood: natural store lighting with mild imperfection.
Constraints: no people, no hands, no dramatic stylization, no broken rug geometry.
Avoid: fake fibers, overprocessed image quality, exaggerated mistakes.`,
      `Use case: photorealistic-natural
Asset type: homepage section image for inventory intake workflow
Primary request: create the cleanest possible believable rough intake photo of a rug in a store.
Scene/backdrop: simple showroom floor.
Subject: one rug photographed quickly for intake.
Style/medium: practical smartphone photo.
Composition/framing: one strong simple frame, slightly imperfect, instantly readable.
Lighting/mood: ordinary store light.
Constraints: no people, no clutter, no catalog polish, no broken rug symmetry.
Avoid: busy surroundings, dramatic angles, synthetic texture.`
    ]
  },
  'inventory-after': {
    size: '1536x1024',
    mode: 'edit',
    prompts: [
      `Use case: precise-object-edit
Asset type: homepage section image for inventory enhancement workflow
Primary request: transform this rough rug intake photo into a clean inventory-ready result.
Input images: Image 1: edit target, preserve the same rug pattern and identity.
Scene/backdrop: simple clean neutral background.
Subject: the same rug from the input image.
Style/medium: premium realistic product photography.
Composition/framing: rug centered, straightened, fully visible, clean edges, background simplified.
Lighting/mood: brighter, cleaner, premium but believable.
Text (verbatim): ""
Constraints: keep the same rug design and color identity; change the photo from rough showroom intake to clean inventory-ready presentation; no dashboard UI; no decorative props; no watermark.
Avoid: changing the rug pattern, warping the rug, adding furniture, fake AI effects, catalog text overlays.`,
      `Use case: precise-object-edit
Asset type: homepage section image for inventory enhancement workflow
Primary request: clean up this same rug image into a bright centered inventory-ready result.
Input images: Image 1: edit target, preserve the rug identity.
Scene/backdrop: warm neutral studio-like background.
Subject: same rug only.
Composition/framing: straighter, cleaner, centered, more balanced.
Lighting/mood: improved brightness and clarity, premium but realistic.
Constraints: preserve rug design, preserve colors, remove distracting showroom context, no UI.
Avoid: changing the rug itself, background clutter, unrealistic perfection, fake shadows.`,
      `Use case: precise-object-edit
Asset type: homepage section image for inventory enhancement workflow
Primary request: simplify this image into a polished clean rug presentation.
Input images: Image 1: edit target.
Scene/backdrop: plain neutral background.
Subject: same rug.
Composition/framing: very clear, centered, immediately understandable.
Lighting/mood: balanced and clean.
Constraints: preserve the rug, remove distractions, no extra objects, no text.
Avoid: over-stylization, texture damage, pattern distortion.`,
      `Use case: precise-object-edit
Asset type: homepage section image for inventory enhancement workflow
Primary request: create an exceptionally realistic cleaned inventory image from this input rug photo.
Input images: Image 1: edit target.
Scene/backdrop: premium neutral background only.
Subject: same rug with precise textile preservation.
Composition/framing: centered and straight with believable edges and realistic depth.
Lighting/mood: high clarity, premium, real.
Constraints: preserve rug identity exactly, no props, no text, no interface.
Avoid: synthetic fibers, warped borders, changed pattern, unnaturally floating rug.`,
      `Use case: precise-object-edit
Asset type: homepage section image for inventory enhancement workflow
Primary request: create the cleanest possible inventory-ready rug image from this exact input.
Input images: Image 1: edit target.
Scene/backdrop: simple neutral background.
Subject: same rug only.
Composition/framing: one strong centered presentation.
Lighting/mood: clean and trustworthy.
Constraints: preserve the rug design, remove showroom distractions, no text, no UI, no props.
Avoid: any rug redesign, any pattern distortion, any fancy styling.`
    ]
  },
  'saved-rugs': {
    size: '1536x1024',
    mode: 'generate',
    prompts: [
      `Use case: ui-mockup
Asset type: homepage section visual for customer saved rugs
Primary request: create a premium product-adjacent visual showing customers saving rugs they like.
Scene/backdrop: clean warm interface environment with rug-focused product cards, not a dashboard.
Subject: a few premium rug cards in a refined interface, with one clear heart or save action visible.
Style/medium: believable polished product mockup, warm and premium.
Composition/framing: simple layout, clear focal point on saved rug action, enough whitespace, suitable for a marketing section image.
Lighting/mood: calm, premium, warm.
Color palette: cream, sand, soft gold, rug jewel tones.
Materials/textures: believable rug thumbnails with realistic textile detail.
Text (verbatim): ""
Constraints: no people, no CRM dashboard, no analytics, no cluttered tables, minimal text, no logos.
Avoid: generic ecommerce aesthetic, corporate SaaS feel, tiny unreadable UI copy, fake icons, warped rug thumbnails.`,
      `Use case: ui-mockup
Asset type: homepage section visual for customer saved rugs
Primary request: create a cleaner premium saved-rugs interface concept focused on a customer marking rugs as favorites.
Scene/backdrop: minimal warm product interface.
Subject: rug product cards with one obvious saved state.
Style/medium: high-end product mockup.
Composition/framing: less busy, strong hierarchy, product cards first.
Constraints: no people, no dashboard, minimal text, no logos.
Avoid: ecommerce clutter, generic app look, dense UI.`,
      `Use case: ui-mockup
Asset type: homepage section visual for customer saved rugs
Primary request: simplify the saved-rugs concept to the clearest possible premium product-card moment.
Scene/backdrop: warm minimal interface canvas.
Subject: two or three rug cards and one clear saved state.
Style/medium: clean believable product mockup.
Composition/framing: simple, easy to understand instantly.
Constraints: no people, no forms, no dashboard panels, minimal text.
Avoid: clutter, too many cards, noisy backgrounds, warped rug previews.`,
      `Use case: ui-mockup
Asset type: homepage section visual for customer saved rugs
Primary request: create an exceptionally polished saved-rugs product visual with realistic rug thumbnails and restrained interface chrome.
Scene/backdrop: calm premium interface with warm cream background and subtle depth, clearly a product experience but not an ecommerce marketplace.
Subject: two or three premium traditional rugs only, preferably Persian or vintage styles, shown as elegant product cards with one subtle filled-heart saved state.
Style/medium: realistic software marketing mockup, not fantasy UI, not home decor catalog.
Composition/framing: refined, balanced, premium, no oversized title, no giant floating button, no cursor hand.
Constraints: no people, no CRM, no analytics, no logos, minimal text, traditional rugs only, realistic textile detail.
Avoid: uncanny UI, broken icons, dense layouts, generic SaaS cards, modern abstract rugs, bland commodity decor.`,
      `Use case: ui-mockup
Asset type: homepage section visual for customer saved rugs
Primary request: create the cleanest and strongest possible visual for customers saving favorite rugs.
Scene/backdrop: minimal warm interface designed for a premium rug showroom product.
Subject: two or three traditional rug cards with one subtle saved state, all rugs high-end and classic rather than modern or generic.
Style/medium: premium product mockup.
Composition/framing: one strong readable composition, restrained UI, no large heading, no cursor or gesture icon.
Constraints: no people, no extra panels, minimal text, no logos, traditional premium rugs only.
Avoid: visual noise, clutter, generic shopping app look, abstract decor rugs, loud save animations.`
    ]
  },
  'follow-up': {
    size: '1536x1024',
    mode: 'generate',
    prompts: [
      `Use case: ui-mockup
Asset type: homepage section visual for store follow-up on saved customer interest
Primary request: create a premium product-adjacent visual showing a simple store-side follow-up card after a customer saved rugs.
Scene/backdrop: clean warm interface environment, very simple, no enterprise dashboard.
Subject: one elegant follow-up card with placeholder contact cues and liked rugs, clearly tied to rug retail.
Style/medium: believable polished product mockup.
Composition/framing: one main follow-up card with small rug thumbnails or mini cards nearby, easy to understand instantly.
Lighting/mood: calm, premium, practical.
Color palette: cream, sand, muted gold, natural rug colors.
Materials/textures: realistic rug thumbnails, restrained interface surfaces.
Text (verbatim): ""
Constraints: no people, no charts, no analytics, no CRM complexity, minimal text, no logos.
Avoid: dense tables, enterprise UI, generic SaaS panel, tiny unreadable microcopy, warped rug thumbnails.`,
      `Use case: ui-mockup
Asset type: homepage section visual for store follow-up on saved customer interest
Primary request: create a cleaner and more focused follow-up visual for rug store staff.
Scene/backdrop: minimal warm interface.
Subject: one simple customer-interest card and saved rug thumbnails.
Style/medium: premium product mockup.
Composition/framing: strong primary card, secondary rug proof.
Constraints: no people, no charts, no dashboards, minimal text, no logos.
Avoid: CRM bloat, clutter, generic business software look.`,
      `Use case: ui-mockup
Asset type: homepage section visual for store follow-up on saved customer interest
Primary request: simplify the follow-up concept to the clearest possible store-actionable moment.
Scene/backdrop: quiet warm interface canvas.
Subject: one follow-up card and a small saved-rug cue.
Style/medium: believable product-adjacent marketing mockup.
Composition/framing: very simple and easy to read.
Constraints: no people, no enterprise UI, minimal text.
Avoid: clutter, dense forms, noisy panels, warped rug thumbnails.`,
      `Use case: ui-mockup
Asset type: homepage section visual for store follow-up on saved customer interest
Primary request: create an exceptionally polished follow-up visual with realistic rug thumbnails and restrained UI.
Scene/backdrop: calm premium interface for a luxury rug retailer, warm cream tones, subtle depth.
Subject: one elegant store-side interest card tied to two or three traditional saved rugs, with simple contact cues and rug thumbnails.
Style/medium: realistic product mockup, not CRM software.
Composition/framing: refined, premium, balanced, one clear card plus rug proof, no dashboard grid.
Constraints: no people, no analytics, no CRM complexity, no logos, minimal text, traditional rug thumbnails only.
Avoid: uncanny UI, fake charts, generic SaaS admin feel, modern abstract rugs, dense business software layout.`,
      `Use case: ui-mockup
Asset type: homepage section visual for store follow-up on saved customer interest
Primary request: create the cleanest and strongest possible follow-up visual for a rug store.
Scene/backdrop: minimal warm interface for a premium rug-store product.
Subject: one simple contact-and-interest card with small saved-rug proof using traditional premium rug thumbnails.
Style/medium: premium product mockup.
Composition/framing: one strong readable card, no clutter, very clear business-value story.
Constraints: no people, no clutter, minimal text, no logos, no charts, traditional rugs only.
Avoid: busy layouts, CRM styling, visual confusion, generic admin software look.`
      ,
      `Use case: ui-mockup
Asset type: homepage section visual for store follow-up on saved customer interest
Primary request: create a premium internal staff view that shows one interested customer and the rugs he saved.
Scene/backdrop: clean warm product interface, clearly internal store software, not customer-facing.
Subject: one left-side customer interest card with name, phone, email, short showroom note, and next step; one right-side row of two or three traditional saved rug thumbnails.
Style/medium: realistic premium product mockup.
Composition/framing: split layout, left staff card and right saved rugs, instantly understandable.
Constraints: internal store-side view only, no customer email template, no contact form, no CTA buttons, no charts, no logos, minimal text, traditional rugs only.
Avoid: outreach message, newsletter layout, ecommerce checkout feel, generic CRM dashboard, modern abstract rugs.`,
      `Use case: ui-mockup
Asset type: homepage section visual for store follow-up on saved customer interest
Primary request: create a simple staff follow-up board for a rug showroom after a customer saved favorites.
Scene/backdrop: warm cream interface with restrained shadows and premium card surfaces.
Subject: one opportunity card labeled interested customer, with placeholder contact details and saved-rug context.
Style/medium: believable software marketing mockup.
Composition/framing: calm premium composition with one dominant customer card and supporting rug thumbnails.
Constraints: no customer-facing wording, no forms, no buttons to contact us, no analytics, no sales charts, no logos, traditional premium rugs only.
Avoid: email newsletter design, contact page design, generic SaaS admin panels, abstract decor rugs.`,
      `Use case: ui-mockup
Asset type: homepage section visual for store follow-up on saved customer interest
Primary request: create a polished internal showroom lead card tied to saved rugs.
Scene/backdrop: premium minimal interface for traditional rug retail software.
Subject: one store-side lead card showing customer identity, short note, follow-up status, and two or three saved traditional rugs.
Style/medium: realistic product-adjacent mockup, elegant and restrained.
Composition/framing: one strong readable layout, no extra decoration, no customer outreach messaging.
Constraints: no people, no email-template language, no forms, no big action buttons, no charts, no logos, traditional rug thumbnails only.
Avoid: customer-facing invitation, ecommerce shopping design, busy dashboard grid, modern rug styles.`,
      `Use case: ui-mockup
Asset type: homepage section visual for store follow-up on saved customer interest
Primary request: create the clearest possible store-actionable follow-up visual for a luxury rug business.
Scene/backdrop: warm premium interface, calm and minimal.
Subject: a simple interested-customer panel plus saved-rug thumbnails, clearly showing that staff can follow up on real interest.
Style/medium: premium product mockup.
Composition/framing: direct, clean, internal-tool feel, not a customer marketing message.
Constraints: no people, no contact form, no outreach email copy, no CTA buttons, no dashboard complexity, no logos, traditional rugs only.
Avoid: visual clutter, customer-facing copy, fake enterprise CRM, abstract rugs.`
    ]
  },
};

function usage() {
  console.error(`Usage:
  node scripts/marketing-assets/generate-core-visuals.mjs generate --target <target> --attempt <1-5> [--input <path>]
  node scripts/marketing-assets/generate-core-visuals.mjs accept --target <target> --candidate <path>

Targets: ${[...ACCEPTED_TARGETS].join(', ')}`);
  process.exit(1);
}

function parseArgs(argv) {
  const [command, ...rest] = argv.slice(2);
  if (!command) usage();
  const options = { _: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = rest[index + 1];
      if (!next || next.startsWith('--')) {
        options[key] = true;
      } else {
        options[key] = next;
        index += 1;
      }
    } else {
      options._.push(token);
    }
  }
  return { command, options };
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const entries = {};
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [name, ...valueParts] = trimmed.split('=');
    let value = valueParts.join('=').trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    entries[name.trim()] = value;
  }
  return entries;
}

function readApiKey() {
  const envFile = readEnvFile(WEB_ENV_PATH);
  const apiKey = process.env.OPENAI_API_KEY?.trim() || envFile.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY was not found in process env or apps/web/.env.local');
  }
  return apiKey;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureManifest() {
  ensureDir(WORK_ROOT);
  if (!fs.existsSync(MANIFEST_PATH)) {
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), entries: [] }, null, 2));
  }
}

function loadManifest() {
  ensureManifest();
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function saveManifest(manifest) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function assertTarget(target) {
  if (!ACCEPTED_TARGETS.has(target)) {
    throw new Error(`Unsupported target: ${target}`);
  }
}

function targetDir(target) {
  return path.join(WORK_ROOT, target);
}

function withTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function dataUrlToBuffer(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.includes(',')) return null;
  const [, payload] = dataUrl.split(',', 2);
  return Buffer.from(payload, 'base64');
}

async function fetchBinaryFromUrl(url, apiKey) {
  const response = await withTimeout(
    url,
    { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } },
    URL_FETCH_TIMEOUT_MS,
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Image URL fetch failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function parseImageResponse(response, apiKey) {
  const raw = await response.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = payload?.error?.message || raw.slice(0, 500);
    throw new Error(`OpenAI image request failed (${response.status}): ${message}`);
  }
  const first = Array.isArray(payload?.data) ? payload.data[0] : null;
  if (!first || typeof first !== 'object') {
    throw new Error('OpenAI image response missing data.');
  }
  if (typeof first.b64_json === 'string' && first.b64_json.trim()) {
    return Buffer.from(first.b64_json, 'base64');
  }
  if (typeof first.url === 'string' && first.url.trim()) {
    return fetchBinaryFromUrl(first.url, apiKey);
  }
  if (typeof first.b64_json === 'undefined' && typeof first.url === 'undefined' && typeof first.image_base64 === 'string') {
    return Buffer.from(first.image_base64, 'base64');
  }
  throw new Error('OpenAI image response did not include usable image data.');
}

function buildPrompt(target, attempt) {
  const spec = TARGET_SPECS[target];
  const prompt = spec?.prompts?.[attempt - 1];
  if (!prompt) {
    throw new Error(`No prompt for target ${target} attempt ${attempt}`);
  }
  return prompt;
}

async function generateCandidate({ target, attempt, inputPath }) {
  assertTarget(target);
  const spec = TARGET_SPECS[target];
  const attemptNum = Number(attempt);
  if (!Number.isInteger(attemptNum) || attemptNum < 1 || attemptNum > spec.prompts.length) {
    throw new Error(`--attempt must be an integer from 1 to ${spec.prompts.length}`);
  }
  const apiKey = readApiKey();
  const prompt = buildPrompt(target, attemptNum);
  ensureDir(targetDir(target));
  const candidatePath = path.join(targetDir(target), `attempt-${String(attemptNum).padStart(2, '0')}-${nowStamp()}.webp`);

  let response;
  let method = spec.mode;
  let resolvedInput = null;

  if (spec.mode === 'edit') {
    if (!inputPath) {
      throw new Error(`Target ${target} requires --input <path>`);
    }
    resolvedInput = path.resolve(ROOT, inputPath);
    if (!fs.existsSync(resolvedInput)) {
      throw new Error(`Input image not found: ${resolvedInput}`);
    }
    const form = new FormData();
    form.append('model', MODEL);
    form.append('prompt', prompt);
    form.append('quality', QUALITY);
    form.append('size', spec.size);
    form.append('output_format', OUTPUT_FORMAT);
    form.append('background', BACKGROUND);
    form.append('moderation', MODERATION);
    form.append('image', new Blob([fs.readFileSync(resolvedInput)], { type: 'image/webp' }), path.basename(resolvedInput));
    response = await withTimeout(
      OPENAI_EDITS_URL,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      },
      GENERATION_TIMEOUT_MS,
    );
  } else {
    response = await withTimeout(
      OPENAI_IMAGES_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          prompt,
          size: spec.size,
          quality: QUALITY,
          output_format: OUTPUT_FORMAT,
          background: BACKGROUND,
          moderation: MODERATION,
          n: 1,
        }),
      },
      GENERATION_TIMEOUT_MS,
    );
  }

  const imageBuffer = await parseImageResponse(response, apiKey);
  fs.writeFileSync(candidatePath, imageBuffer);

  const manifest = loadManifest();
  manifest.entries.push({
    type: 'generated',
    createdAt: new Date().toISOString(),
    model: MODEL,
    quality: QUALITY,
    target,
    attempt: attemptNum,
    mode: method,
    prompt,
    inputPath: resolvedInput,
    candidatePath: path.relative(ROOT, candidatePath),
    accepted: false,
  });
  saveManifest(manifest);

  console.log(candidatePath);
}

function acceptCandidate({ target, candidate }) {
  assertTarget(target);
  if (!candidate) {
    throw new Error('--candidate is required for accept');
  }
  const candidatePath = path.resolve(ROOT, candidate);
  if (!fs.existsSync(candidatePath)) {
    throw new Error(`Candidate not found: ${candidatePath}`);
  }
  const finalPath = path.join(ROOT, FINAL_PATHS[target]);
  ensureDir(path.dirname(finalPath));
  fs.copyFileSync(candidatePath, finalPath);

  const manifest = loadManifest();
  const relativeCandidate = path.relative(ROOT, candidatePath);
  let updated = false;
  for (let index = manifest.entries.length - 1; index >= 0; index -= 1) {
    const entry = manifest.entries[index];
    if (entry?.candidatePath === relativeCandidate) {
      entry.accepted = true;
      entry.acceptedAt = new Date().toISOString();
      entry.finalPath = FINAL_PATHS[target];
      updated = true;
      break;
    }
  }
  manifest.entries.push({
    type: 'accepted',
    createdAt: new Date().toISOString(),
    target,
    candidatePath: relativeCandidate,
    finalPath: FINAL_PATHS[target],
    linkedToGeneratedEntry: updated,
  });
  saveManifest(manifest);
  console.log(finalPath);
}

async function main() {
  const { command, options } = parseArgs(process.argv);
  if (command === 'generate') {
    await generateCandidate({
      target: options.target || options._[0],
      attempt: options.attempt || options._[1],
      inputPath: options.input,
    });
    return;
  }
  if (command === 'accept') {
    acceptCandidate({
      target: options.target || options._[0],
      candidate: options.candidate || options._[1],
    });
    return;
  }
  usage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
