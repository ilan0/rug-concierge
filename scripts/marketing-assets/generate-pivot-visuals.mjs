#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const WEB_ENV_PATH = path.join(ROOT, 'apps/web/.env.local');
const WORK_ROOT = path.join(ROOT, 'apps/site/public/media/source/generated-pivot');
const MANIFEST_PATH = path.join(WORK_ROOT, 'manifest.json');
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const MODEL = process.env.OPENAI_IMAGE_MODEL?.trim() || 'gpt-image-1.5';
const QUALITY = process.env.OPENAI_IMAGE_QUALITY?.trim() || 'high';
const OUTPUT_FORMAT = 'webp';
const BACKGROUND = 'auto';
const MODERATION = 'low';
const GENERATION_TIMEOUT_MS = 120_000;
const URL_FETCH_TIMEOUT_MS = 60_000;

const TARGETS = {
  'hero-online': {
    size: '1536x1024',
    finalPath: 'apps/site/public/media/hero/hero-online-leads.webp',
    prompts: [
      `Use case: photorealistic-natural
Asset type: landing page hero image for a luxury rug-store lead generation website
Primary request: create a premium editorial-style hero image showing RugDesk as a digital rug salesman for online shoppers.
Scene/backdrop: elegant high-end home interior or refined study setting, clearly a customer browsing from home rather than inside a showroom. Warm neutral surroundings, luxury rug visible in the room, calm expensive atmosphere.
Subject: one laptop or tablet on a table showing a believable rug concierge interface with a short customer request and matching rug recommendations. Keep the device screen readable in structure but not dependent on tiny text. The device should feel natural and premium.
Style/medium: photorealistic editorial photography, warm, trustworthy, luxurious, not illustration.
Composition/framing: wide cinematic composition with generous negative space for homepage headline and CTA, device on one side, room context on the other. Leave a stable hero media zone that could later hold motion in the same frame.
Lighting/mood: warm daylight or soft residential evening light, premium and calm.
Constraints: no clear faces, no cheesy smiling stock people, no logos, no generic office, no futuristic glow, no dashboard charts, no warped rugs, no kiosk feeling.
Avoid: store kiosk look, SaaS dashboard look, corporate office vibe, unreadable microcopy, gimmicky AI motifs.`,
      `Use case: photorealistic-natural
Asset type: landing page hero image for a luxury rug-store lead generation website
Primary request: create a cleaner and more obviously online-shopping-focused hero scene for RugDesk.
Scene/backdrop: upscale home setting with one beautiful rug and calm luxury decor, clearly not a physical rug store.
Subject: a premium device showing a digital rug salesman helping an online customer compare rugs. Recommendations visible, no tiny dependent text.
Style/medium: high-end commercial editorial photo.
Composition/framing: simplified hero composition with strong copy space and one clear media focal point.
Lighting/mood: warm, calm, high-trust.
Constraints: no people, no logos, no charts, no heavy UI chrome, no store-floor look.
Avoid: busy room, futuristic effects, fake CGI, noisy interface.`,
      `Use case: photorealistic-natural
Asset type: landing page hero image for a luxury rug-store lead generation website
Primary request: create the strongest possible premium online-sales hero for a rug business.
Scene/backdrop: warm residential interior with a premium rug, subtle texture, elegant furniture, no clutter.
Subject: one laptop or tablet showing a digital rug salesman with recommendations.
Style/medium: photoreal editorial lifestyle image.
Composition/framing: one strong static hero frame sized for later motion replacement, clear copy area, direct focal hierarchy.
Lighting/mood: calm, premium, reassuring.
Constraints: no faces, no logos, no dashboards, no store kiosk look, no clutter.
Avoid: generic startup ad style, tech office feel, warped textile detail.`,
      `Use case: photorealistic-natural
Asset type: landing page hero image for a luxury rug-store lead generation website
Primary request: create an exceptionally realistic premium home-browsing hero image for RugDesk.
Scene/backdrop: high-end residential environment, luxurious but not flashy, one visible rug anchoring the scene.
Subject: premium device with believable rug-sales interface helping a remote shopper.
Style/medium: extremely realistic editorial photography.
Composition/framing: wide, balanced, calm, strong headline space.
Lighting/mood: warm and refined.
Constraints: no people, no logos, no charts, no gimmicks.
Avoid: fake textures, awkward device placement, clutter, store-floor cues.`,
      `Use case: photorealistic-natural
Asset type: landing page hero image for a luxury rug-store lead generation website
Primary request: create the cleanest possible static hero for RugDesk’s new lead-generation website.
Scene/backdrop: warm refined home interior with one visible premium rug.
Subject: one device with simple recommendation interface.
Style/medium: photorealistic editorial business image.
Composition/framing: minimal, premium, quiet, motion-ready hero slot.
Constraints: no people, no logos, no charts, no kiosk cues, no clutter.
Avoid: visual confusion, dashboard UI, corporate office styling.`
    ]
  },
  'customer-interest': {
    size: '1536x1024',
    finalPath: 'apps/site/public/media/product/customer-interest.webp',
    prompts: [
      `Use case: ui-mockup
Asset type: homepage section visual for online customer interest
Primary request: create a premium product visual showing an online shopper saving rugs and leaving clear interest for the store.
Scene/backdrop: warm minimal premium interface, built for a high-end rug store website.
Subject: elegant rug recommendation cards with one or two saved states plus a subtle customer-interest cue, such as saved list tied to contact or appointment interest. Focus on traditional high-end rugs.
Style/medium: believable product-adjacent mockup, restrained, warm, trustworthy.
Composition/framing: clear visual story from recommendations to saved interest, no clutter, no busy dashboard.
Constraints: no people, no charts, no CRM dashboard, minimal text, traditional rugs only, no generic ecommerce feel.
Avoid: giant heart icon gimmicks, cursor hands, fake analytics, commodity decor rugs.`,
      `Use case: ui-mockup
Asset type: homepage section visual for online customer interest
Primary request: create a simpler premium saved-interest visual for RugDesk.
Scene/backdrop: calm cream interface with subtle depth.
Subject: recommended rugs, one clear saved state, subtle contact-interest cue.
Style/medium: clean premium mockup.
Composition/framing: simple and direct, product cards first.
Constraints: no people, no dashboard, minimal text, traditional rugs only.
Avoid: loud icons, generic shopping app look, abstract decor rugs.`,
      `Use case: ui-mockup
Asset type: homepage section visual for online customer interest
Primary request: create the clearest possible visual that tells the store a website visitor is interested in specific rugs.
Scene/backdrop: warm premium interface.
Subject: saved rugs plus a calm signal that the customer wants follow-up.
Style/medium: believable product marketing mockup.
Composition/framing: one strong clean composition, easy to understand instantly.
Constraints: no people, no charts, no dense UI, minimal text.
Avoid: ecommerce clutter, dashboard feel, noisy decoration.`,
      `Use case: ui-mockup
Asset type: homepage section visual for online customer interest
Primary request: create an exceptionally polished customer-interest mockup for RugDesk.
Scene/backdrop: elegant premium product surface.
Subject: high-end traditional rug cards, saved shortlist, subtle interest state.
Style/medium: realistic product-adjacent interface.
Composition/framing: balanced, premium, quiet.
Constraints: no people, no CRM, no logos, minimal text.
Avoid: uncanny UI, giant icons, generic SaaS blocks.`,
      `Use case: ui-mockup
Asset type: homepage section visual for online customer interest
Primary request: create the cleanest and strongest visual for online rug interest capture.
Scene/backdrop: warm minimal product interface.
Subject: shortlist of traditional rugs with a clear interested-customer state.
Style/medium: premium product mockup.
Composition/framing: one concise story.
Constraints: no people, no clutter, no graphs, no logos, traditional rugs only.
Avoid: shopping-cart feel, visual noise, generic retail app look.`
    ]
  },
  'appointment-booking': {
    size: '1536x1024',
    finalPath: 'apps/site/public/media/product/appointment-booking.webp',
    prompts: [
      `Use case: ui-mockup
Asset type: homepage section visual for appointment booking
Primary request: create a premium product visual showing an online shopper booking a showroom appointment after finding rugs they like.
Scene/backdrop: warm premium interface for a high-end rug store website.
Subject: a clean appointment request card tied to specific rugs or a shortlist, with a subtle calendar/time selection feel and a private showroom visit theme.
Style/medium: believable premium product mockup.
Composition/framing: one main appointment card and supporting rug visuals, clear and calm.
Constraints: no people, no generic scheduling dashboard, no clinical calendar software look, minimal text, traditional rugs only.
Avoid: enterprise calendar app feel, fake charts, loud UI, generic SaaS widgets.`,
      `Use case: ui-mockup
Asset type: homepage section visual for appointment booking
Primary request: create a simpler premium showroom-visit request visual for RugDesk.
Scene/backdrop: quiet cream interface.
Subject: shortlisted rugs plus a gentle request-private-showing card.
Style/medium: clean product mockup.
Composition/framing: direct and elegant.
Constraints: no people, no charts, no dashboard, traditional rugs only.
Avoid: busy calendars, generic booking app appearance, clutter.`,
      `Use case: ui-mockup
Asset type: homepage section visual for appointment booking
Primary request: create the clearest possible visual for booking an in-store rug appointment from the website.
Scene/backdrop: premium product interface.
Subject: selected rugs and a tasteful appointment request panel.
Style/medium: believable marketing mockup.
Composition/framing: simple and immediately readable.
Constraints: no people, no charts, minimal text, traditional rugs only.
Avoid: loud icons, scheduling-software look, clutter.`,
      `Use case: ui-mockup
Asset type: homepage section visual for appointment booking
Primary request: create an exceptionally polished appointment-request visual for RugDesk.
Scene/backdrop: elegant warm interface.
Subject: private showroom appointment tied to rug interest.
Style/medium: realistic product-adjacent interface.
Composition/framing: balanced, premium, calm.
Constraints: no people, no generic calendar dashboard, no logos, minimal text.
Avoid: enterprise software feel, unreadable small text, noisy decoration.`,
      `Use case: ui-mockup
Asset type: homepage section visual for appointment booking
Primary request: create the cleanest possible showroom appointment visual for a luxury rug store website.
Scene/backdrop: warm minimal interface.
Subject: one appointment request panel and clear rug interest proof.
Style/medium: premium product mockup.
Composition/framing: one strong concise composition.
Constraints: no people, no clutter, traditional rugs only.
Avoid: generic booking product feel, visual noise, charts.`
    ]
  },
  'staff-handoff': {
    size: '1536x1024',
    finalPath: 'apps/site/public/media/product/staff-handoff.webp',
    prompts: [
      `Use case: ui-mockup
Asset type: homepage section visual for store-side handoff
Primary request: create a premium product visual showing store staff clearly seeing who is interested, which rugs they liked, and what to do next.
Scene/backdrop: internal store-facing interface, warm and premium, not a CRM dashboard.
Subject: one interested-customer card with contact details, a short note, and linked rug thumbnails showing saved interest.
Style/medium: realistic product-adjacent mockup, calm and trustworthy.
Composition/framing: clear split between interested customer and rug proof, immediately understandable.
Constraints: no people, no charts, no fake analytics, no giant dashboard, traditional rugs only, minimal text.
Avoid: customer-facing email template, generic CRM admin feel, enterprise software styling.`,
      `Use case: ui-mockup
Asset type: homepage section visual for store-side handoff
Primary request: create a simpler premium handoff view for RugDesk staff.
Scene/backdrop: warm internal product interface.
Subject: customer interest card and saved rugs.
Style/medium: believable product mockup.
Composition/framing: direct, clear, low-clutter.
Constraints: no people, no charts, no CRM sprawl, traditional rugs only.
Avoid: outreach email look, booking-dashboard look, noisy layout.`,
      `Use case: ui-mockup
Asset type: homepage section visual for store-side handoff
Primary request: create the clearest possible staff-side follow-up visual for a rug store.
Scene/backdrop: quiet premium interface.
Subject: customer lead details plus rugs of interest.
Style/medium: product-adjacent mockup.
Composition/framing: one strong readable layout.
Constraints: no people, no charts, minimal text, traditional rugs only.
Avoid: dashboard clutter, customer-facing copy, generic SaaS appearance.`,
      `Use case: ui-mockup
Asset type: homepage section visual for store-side handoff
Primary request: create an exceptionally polished staff handoff visual for RugDesk.
Scene/backdrop: elegant internal tool interface, warm and premium.
Subject: actionable customer-interest card with rug thumbnails.
Style/medium: realistic high-end product mockup.
Composition/framing: balanced, premium, calm.
Constraints: no people, no charts, no CRM complexity, minimal text.
Avoid: enterprise software feel, unreadable tiny copy, generic admin design.`,
      `Use case: ui-mockup
Asset type: homepage section visual for store-side handoff
Primary request: create the strongest possible visual for helping store staff follow up on online rug interest.
Scene/backdrop: warm minimal internal interface.
Subject: one lead card and supporting traditional rug shortlist.
Style/medium: premium product mockup.
Composition/framing: clean, direct, actionable.
Constraints: no people, no clutter, no charts, traditional rugs only.
Avoid: email-template feel, dashboard sprawl, visual confusion.`
    ]
  }
};

function usage() {
  console.error(`Usage:\n  node scripts/marketing-assets/generate-pivot-visuals.mjs generate --target <target> --attempt <n>\n  node scripts/marketing-assets/generate-pivot-visuals.mjs accept --target <target> --candidate <path>\nTargets: ${Object.keys(TARGETS).join(', ')}`);
  process.exit(1);
}

function parseArgs(argv) {
  const [command, ...rest] = argv.slice(2);
  if (!command) usage();
  const options = { _: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (!next || next.startsWith('--')) {
        options[key] = true;
      } else {
        options[key] = next;
        i += 1;
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
  if (!apiKey) throw new Error('OPENAI_API_KEY missing in process env or apps/web/.env.local');
  return apiKey;
}

function ensureDir(dirPath) { fs.mkdirSync(dirPath, { recursive: true }); }
function nowStamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }

function loadManifest() {
  ensureDir(WORK_ROOT);
  if (!fs.existsSync(MANIFEST_PATH)) {
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), entries: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function saveManifest(manifest) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
}

function withTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function fetchBinaryFromUrl(url, apiKey) {
  const response = await withTimeout(url, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } }, URL_FETCH_TIMEOUT_MS);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Image URL fetch failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function parseImageResponse(response, apiKey) {
  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = null; }
  if (!response.ok) {
    const message = payload?.error?.message || raw.slice(0, 500);
    throw new Error(`OpenAI image request failed (${response.status}): ${message}`);
  }
  const first = Array.isArray(payload?.data) ? payload.data[0] : null;
  if (!first || typeof first !== 'object') throw new Error('Image response missing data');
  if (typeof first.b64_json === 'string' && first.b64_json.trim()) return Buffer.from(first.b64_json, 'base64');
  if (typeof first.url === 'string' && first.url.trim()) return fetchBinaryFromUrl(first.url, apiKey);
  throw new Error('No usable image data returned');
}

async function generateCandidate(target, attempt) {
  const spec = TARGETS[target];
  if (!spec) throw new Error(`Unsupported target: ${target}`);
  const attemptNum = Number(attempt);
  if (!Number.isInteger(attemptNum) || attemptNum < 1 || attemptNum > spec.prompts.length) {
    throw new Error(`Attempt must be 1..${spec.prompts.length}`);
  }
  const prompt = spec.prompts[attemptNum - 1];
  const apiKey = readApiKey();
  const targetDir = path.join(WORK_ROOT, target);
  ensureDir(targetDir);
  const candidatePath = path.join(targetDir, `attempt-${String(attemptNum).padStart(2, '0')}-${nowStamp()}.webp`);
  const response = await withTimeout(
    OPENAI_IMAGES_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
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
  const buf = await parseImageResponse(response, apiKey);
  fs.writeFileSync(candidatePath, buf);
  const manifest = loadManifest();
  manifest.entries.push({ type: 'generated', createdAt: new Date().toISOString(), target, attempt: attemptNum, candidatePath: path.relative(ROOT, candidatePath), prompt, accepted: false, model: MODEL, quality: QUALITY });
  saveManifest(manifest);
  console.log(candidatePath);
}

function acceptCandidate(target, candidate) {
  const spec = TARGETS[target];
  if (!spec) throw new Error(`Unsupported target: ${target}`);
  const candidatePath = path.resolve(ROOT, candidate);
  if (!fs.existsSync(candidatePath)) throw new Error(`Candidate not found: ${candidatePath}`);
  const finalPath = path.join(ROOT, spec.finalPath);
  ensureDir(path.dirname(finalPath));
  fs.copyFileSync(candidatePath, finalPath);
  const manifest = loadManifest();
  const rel = path.relative(ROOT, candidatePath);
  for (let i = manifest.entries.length - 1; i >= 0; i -= 1) {
    if (manifest.entries[i]?.candidatePath === rel) {
      manifest.entries[i].accepted = true;
      manifest.entries[i].acceptedAt = new Date().toISOString();
      manifest.entries[i].finalPath = spec.finalPath;
      break;
    }
  }
  manifest.entries.push({ type: 'accepted', createdAt: new Date().toISOString(), target, candidatePath: rel, finalPath: spec.finalPath });
  saveManifest(manifest);
  console.log(finalPath);
}

async function main() {
  const { command, options } = parseArgs(process.argv);
  if (command === 'generate') return generateCandidate(options.target || options._[0], options.attempt || options._[1]);
  if (command === 'accept') return acceptCandidate(options.target || options._[0], options.candidate || options._[1]);
  usage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
