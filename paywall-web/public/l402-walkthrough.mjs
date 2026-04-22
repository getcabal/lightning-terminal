#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import os from 'node:os';
import readline from 'node:readline/promises';
import http from 'node:http';
import https from 'node:https';

const DEFAULT_BASE_URL = 'https://l402.lightningnode.app';
const DEFAULT_SKILL_ID = 'lightning-desktop-live-local-lnd';
const DEFAULT_PRICE_SATS = 21;
const MAX_PREVIEW_LINES = 24;
const DEFAULT_CHALLENGE_DIR = path.join(os.homedir(), '.l402-walkthrough', 'challenges');

const ansi = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function style(text, color) {
  if (!interactive) {
    return text;
  }

  return `${color}${text}${ansi.reset}`;
}

function heading(text) {
  return style(text, ansi.bold);
}

function subheading(text) {
  return style(text, ansi.cyan);
}

function success(text) {
  return style(text, ansi.green);
}

function warning(text) {
  return style(text, ansi.yellow);
}

function danger(text) {
  return style(text, ansi.red);
}

function dim(text) {
  return style(text, ansi.dim);
}

function spacer() {
  process.stdout.write('\n');
}

function printBlock(text) {
  process.stdout.write(`${text}\n`);
}

function printList(items) {
  for (const item of items) {
    printBlock(`- ${item}`);
  }
}

function trimTrailingSlash(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function isPositiveIntegerString(value) {
  return /^[1-9]\d*$/.test(value);
}

function isHex64(value) {
  return /^[0-9a-f]{64}$/i.test(value);
}

function isLikelyBolt11Invoice(value) {
  return /^ln[a-z0-9]+$/i.test(value);
}

function sanitizeFileComponent(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'challenge';
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/:/g, '-').replace(/\.\d{3}z$/i, 'z');
}

function formatPathForDisplay(filePath) {
  const homeDir = os.homedir();
  if (filePath.startsWith(`${homeDir}${path.sep}`)) {
    return `~/${path.relative(homeDir, filePath)}`;
  }

  return filePath;
}

function extractChallengeMetadataFromPaidUrl(paidUrl) {
  const match = paidUrl.match(
    /^\/\.well-known\/l402\/skills\/([^/]+)\/v\/([0-9a-f]{64})\/content(?:\?.*)?$/i,
  );

  return {
    skillId: match?.[1] ?? null,
    contentSha256: match?.[2]?.toLowerCase() ?? null,
  };
}

function normalizePaidUrl(value, baseUrl) {
  const input = value.trim();
  if (!input) {
    throw new Error('Paid URL is required.');
  }

  if (input.startsWith('/')) {
    return input;
  }

  const parsed = new URL(input);
  const expectedOrigin = new URL(baseUrl).origin;
  if (parsed.origin !== expectedOrigin) {
    throw new Error(`Paid URL must use the same origin as ${expectedOrigin}.`);
  }

  return `${parsed.pathname}${parsed.search}`;
}

function normalizeChallengeBundle(input, defaults = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Challenge details must be a JSON object.');
  }

  const baseUrlRaw =
    typeof input.baseUrl === 'string'
      ? input.baseUrl
      : typeof defaults.baseUrl === 'string'
        ? defaults.baseUrl
        : DEFAULT_BASE_URL;
  const parsedBaseUrl = new URL(baseUrlRaw);
  const baseUrl = trimTrailingSlash(parsedBaseUrl.toString());

  const paidUrlSource =
    typeof input.paidUrl === 'string'
      ? input.paidUrl
      : typeof input.paid_url === 'string'
        ? input.paid_url
        : typeof defaults.paidUrl === 'string'
          ? defaults.paidUrl
          : '';
  const paidUrl = normalizePaidUrl(paidUrlSource, baseUrl);
  const paidUrlMetadata = extractChallengeMetadataFromPaidUrl(paidUrl);

  const skillId =
    typeof input.skillId === 'string'
      ? input.skillId.trim()
      : typeof input.skill_id === 'string'
        ? input.skill_id.trim()
        : typeof defaults.skillId === 'string'
          ? defaults.skillId
          : paidUrlMetadata.skillId;
  if (!skillId) {
    throw new Error('Skill ID is required or must be derivable from the paid URL.');
  }

  const invoice =
    typeof input.invoice === 'string'
      ? input.invoice.trim()
      : typeof defaults.invoice === 'string'
        ? defaults.invoice
        : '';
  if (!isLikelyBolt11Invoice(invoice)) {
    throw new Error('Invoice must be a BOLT11 invoice beginning with ln.');
  }

  const macaroon =
    typeof input.macaroon === 'string'
      ? input.macaroon.trim()
      : typeof input.macaroonB64 === 'string'
        ? input.macaroonB64.trim()
        : typeof input.macaroon_b64 === 'string'
          ? input.macaroon_b64.trim()
          : typeof defaults.macaroon === 'string'
            ? defaults.macaroon
            : '';
  if (!macaroon) {
    throw new Error('Macaroon is required.');
  }

  const schemeRaw =
    typeof input.scheme === 'string'
      ? input.scheme
      : typeof defaults.scheme === 'string'
        ? defaults.scheme
        : 'L402';
  const scheme = /^(LSAT|L402)$/i.test(schemeRaw) ? schemeRaw.toUpperCase() : 'L402';

  const title =
    typeof input.title === 'string'
      ? input.title
      : typeof defaults.title === 'string'
        ? defaults.title
        : null;
  const contentSha256 =
    typeof input.contentSha256 === 'string'
      ? input.contentSha256.toLowerCase()
      : typeof input.content_sha256 === 'string'
        ? input.content_sha256.toLowerCase()
        : typeof defaults.contentSha256 === 'string'
          ? defaults.contentSha256
          : paidUrlMetadata.contentSha256;

  const priceSource =
    typeof input.priceSats === 'number'
      ? input.priceSats
      : typeof input.price_sats === 'number'
        ? input.price_sats
        : typeof defaults.priceSats === 'number'
          ? defaults.priceSats
          : null;
  const priceSats = Number.isInteger(priceSource) ? priceSource : null;

  return {
    baseUrl,
    skillId,
    title,
    priceSats,
    contentSha256: contentSha256 || null,
    paidUrl,
    invoice,
    macaroon,
    scheme,
    capturedAt:
      typeof input.capturedAt === 'string'
        ? input.capturedAt
        : typeof input.savedAt === 'string'
          ? input.savedAt
          : typeof defaults.capturedAt === 'string'
            ? defaults.capturedAt
            : null,
    sourceFile:
      typeof defaults.sourceFile === 'string' ? defaults.sourceFile : null,
  };
}

function suggestedChallengeFilePath(bundle) {
  const skill = sanitizeFileComponent(bundle.skillId);
  const sha = sanitizeFileComponent((bundle.contentSha256 || 'challenge').slice(0, 12));
  return path.join(
    DEFAULT_CHALLENGE_DIR,
    `${skill}-${sha}-${timestampForFile()}.json`,
  );
}

async function promptInput({
  label,
  description,
  defaultValue,
  validate,
  allowEmpty = false,
}) {
  spacer();
  printBlock(heading(label));
  if (description) {
    printBlock(dim(description));
  }

  while (true) {
    const suffix = defaultValue !== undefined ? ` [${defaultValue}]` : '';
    const answer = (await rl.question(`> ${label}${suffix}: `)).trim();
    const value =
      answer === '' && defaultValue !== undefined ? String(defaultValue) : answer;

    if (value === '' && allowEmpty) {
      return '';
    }

    if (value === '' && !allowEmpty) {
      printBlock(danger('This value is required.'));
      continue;
    }

    if (validate) {
      const error = validate(value);
      if (error) {
        printBlock(danger(error));
        continue;
      }
    }

    return value;
  }
}

async function promptSecret({ label, description, validate, allowEmpty = false }) {
  spacer();
  printBlock(heading(label));
  if (description) {
    printBlock(dim(description));
  }

  while (true) {
    const value = (await readHidden(`${label}: `)).trim();

    if (value === '' && allowEmpty) {
      return '';
    }

    if (value === '' && !allowEmpty) {
      printBlock(danger('This value is required.'));
      continue;
    }

    if (validate) {
      const error = validate(value);
      if (error) {
        printBlock(danger(error));
        continue;
      }
    }

    return value;
  }
}

async function readHidden(promptText) {
  if (!interactive) {
    return rl.question(`> ${promptText}`);
  }

  rl.pause();
  process.stdout.write(`> ${promptText}`);

  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve, reject) => {
    let value = '';

    function cleanup() {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(Boolean(wasRaw));
      rl.resume();
    }

    function onData(chunk) {
      const input = chunk.toString('utf8');

      for (const char of input) {
        if (char === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          reject(new Error('Cancelled'));
          return;
        }

        if (char === '\r' || char === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }

        if (char === '\u007f') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }

        value += char;
        process.stdout.write('*');
      }
    }

    process.stdin.on('data', onData);
  });
}

async function promptChoice({ label, description, options }) {
  spacer();
  printBlock(heading(label));
  if (description) {
    printBlock(dim(description));
  }

  options.forEach((option, index) => {
    const recommended = option.recommended ? ` ${style('(Recommended)', ansi.green)}` : '';
    printBlock(`${index + 1}. ${option.label}${recommended}`);
    if (option.description) {
      printBlock(`   ${dim(option.description)}`);
    }
  });

  while (true) {
    const answer = (await rl.question('> Select an option: ')).trim();
    const parsed = Number.parseInt(answer, 10);

    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= options.length) {
      return options[parsed - 1].value;
    }

    printBlock(danger(`Please enter a number between 1 and ${options.length}.`));
  }
}

async function promptEnterToContinue(message = 'Press Enter to continue.') {
  spacer();
  await rl.question(`${dim(message)} `);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function splitAuthenticateHeader(value) {
  if (!value) {
    return [];
  }

  const raw = Array.isArray(value) ? value : [value];
  return raw
    .flatMap((line) =>
      line
        .split(/,(?=\s*(?:LSAT|L402)\s+macaroon=)/i)
        .map((part) => part.trim())
        .filter(Boolean),
    );
}

function parseChallenges(value) {
  return splitAuthenticateHeader(value)
    .map((line) => {
      const match = line.match(
        /^(LSAT|L402)\s+macaroon="([^"]+)"\s*,\s*invoice="([^"]+)"$/i,
      );
      if (!match) {
        return null;
      }

      return {
        scheme: match[1].toUpperCase(),
        macaroon: match[2],
        invoice: match[3],
      };
    })
    .filter(Boolean);
}

function requestRaw(urlString, { method = 'GET', headers = {}, body } = {}) {
  const url = new URL(urlString);
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method,
        headers,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: data,
            json: parseJson(data),
          });
        });
      },
    );

    req.on('error', reject);

    if (body) {
      req.write(body);
    }

    req.end();
  });
}

async function fetchManifest(baseUrl, skillId) {
  return requestRaw(`${trimTrailingSlash(baseUrl)}/.well-known/l402/skills/${skillId}`);
}

async function fetchChallenge(baseUrl, paidUrl) {
  return requestRaw(`${trimTrailingSlash(baseUrl)}${paidUrl}`);
}

async function fetchAuthorizedContent(baseUrl, paidUrl, authorization) {
  return requestRaw(`${trimTrailingSlash(baseUrl)}${paidUrl}`, {
    headers: {
      Authorization: authorization,
    },
  });
}

async function publishSkill(baseUrl, adminToken, payload) {
  return requestRaw(`${trimTrailingSlash(baseUrl)}/api/admin/publish-skill`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n*/);
  if (!match) {
    return {};
  }

  const frontmatter = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (kv) {
      frontmatter[kv[1]] = kv[2].trim();
    }
  }

  return frontmatter;
}

function firstMarkdownHeading(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : '';
}

async function loadMarkdownFile(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return {
    content,
    frontmatter: parseFrontmatter(content),
    title: firstMarkdownHeading(content),
  };
}

async function discoverSkillFiles(repoRoot) {
  const skillsDir = path.join(repoRoot, 'skills');

  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const candidate = path.join(skillsDir, entry.name, 'SKILL.md');
      try {
        await fs.access(candidate);
        files.push(candidate);
      } catch {
        // Ignore missing files.
      }
    }

    return files.sort();
  } catch {
    return [];
  }
}

function summarizeManifest(manifest) {
  spacer();
  printBlock(subheading('Live manifest'));
  printList([
    `skill_id: ${manifest.skill_id}`,
    `title: ${manifest.title}`,
    `price_sats: ${manifest.price_sats}`,
    `content_sha256: ${manifest.content_sha256}`,
    `purchase_model: ${manifest.purchase_model}`,
    `paid_url: ${manifest.paid_url}`,
  ]);
}

function summarizeChallenge(response, challenge) {
  spacer();
  printBlock(subheading('Payment challenge'));
  printList([
    `HTTP status: ${response.status}`,
    `scheme: ${challenge.scheme}`,
    `invoice: ${challenge.invoice}`,
    `macaroon length: ${challenge.macaroon.length} characters`,
  ]);
}

function previewContent(body) {
  const lines = body.split('\n');
  return lines.slice(0, MAX_PREVIEW_LINES).join('\n');
}

function printChallengeBundle(bundle, headingText = 'Challenge details') {
  spacer();
  printBlock(subheading(headingText));

  const lines = [
    `base URL: ${bundle.baseUrl}`,
    `skill ID: ${bundle.skillId}`,
    `paid URL: ${bundle.baseUrl}${bundle.paidUrl}`,
  ];

  if (bundle.contentSha256) {
    lines.push(`content_sha256: ${bundle.contentSha256}`);
  }
  if (bundle.priceSats !== null) {
    lines.push(`price_sats: ${bundle.priceSats}`);
  }
  if (bundle.sourceFile) {
    lines.push(`challenge file: ${formatPathForDisplay(bundle.sourceFile)}`);
  }

  printList(lines);
  printBlock(`Invoice: ${bundle.invoice}`);
  printBlock(`Macaroon: ${bundle.macaroon}`);
}

async function saveChallengeBundle(bundle, outputPath) {
  const payload = {
    baseUrl: bundle.baseUrl,
    skillId: bundle.skillId,
    title: bundle.title,
    priceSats: bundle.priceSats,
    contentSha256: bundle.contentSha256,
    paidUrl: bundle.paidUrl,
    invoice: bundle.invoice,
    macaroon: bundle.macaroon,
    scheme: bundle.scheme,
    capturedAt: bundle.capturedAt ?? new Date().toISOString(),
    savedAt: new Date().toISOString(),
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function offerChallengeSave(bundle) {
  const action = await promptChoice({
    label: 'What do you want to do with this challenge?',
    description:
      'Saving keeps the invoice, macaroon, and paid URL together so you can resume later without mixing different challenges.',
    options: [
      {
        label: 'Save challenge to a file',
        description: 'Best if you want to pay now and return later with the matching preimage.',
        value: 'save',
        recommended: true,
      },
      {
        label: 'Return to the main menu',
        description: 'Do not save a file right now.',
        value: 'back',
      },
    ],
  });

  if (action !== 'save') {
    return;
  }

  const outputPath = await promptInput({
    label: 'Challenge file path',
    description:
      'Choose any writable JSON path. The default stores the challenge under ~/.l402-walkthrough/challenges.',
    defaultValue: suggestedChallengeFilePath(bundle),
  });

  await saveChallengeBundle(bundle, outputPath);
  spacer();
  printBlock(success(`Saved challenge file to ${outputPath}`));
  printBlock(
    dim('Use “Resume a saved invoice or prior challenge” later to continue with this exact invoice and macaroon.'),
  );
}

async function pauseChallengeForLater(bundle, message = 'Challenge captured successfully.') {
  spacer();
  printBlock(success(message));
  printChallengeBundle(bundle, 'Keep these challenge details together');
  printBlock(
    dim('The invoice, macaroon, and payment preimage must all come from the same challenge attempt.'),
  );
  await offerChallengeSave(bundle);
}

async function discoverSavedChallengeFiles() {
  try {
    const entries = await fs.readdir(DEFAULT_CHALLENGE_DIR, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }

      const filePath = path.join(DEFAULT_CHALLENGE_DIR, entry.name);
      const stat = await fs.stat(filePath);
      files.push({ filePath, mtimeMs: stat.mtimeMs });
    }

    return files
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      .map((entry) => entry.filePath);
  } catch {
    return [];
  }
}

async function loadSavedChallengeBundle(defaults = {}) {
  const savedFiles = await discoverSavedChallengeFiles();
  let filePath = '';

  if (savedFiles.length > 0) {
    const fileChoice = await promptChoice({
      label: 'Which saved challenge do you want to load?',
      description:
        'Choose one of the previously saved invoice/macaroon bundles or enter another JSON file path.',
      options: [
        ...savedFiles.slice(0, 6).map((savedFile, index) => ({
          label: formatPathForDisplay(savedFile),
          description: 'Saved challenge bundle.',
          value: { type: 'saved', path: savedFile },
          recommended: index === 0,
        })),
        {
          label: 'Enter another challenge file path',
          description: 'Load a JSON file from any location on disk.',
          value: { type: 'custom' },
        },
        {
          label: 'Return to the previous menu',
          description: 'Do not load a file right now.',
          value: { type: 'back' },
        },
      ],
    });

    if (fileChoice.type === 'back') {
      return null;
    }

    if (fileChoice.type === 'saved') {
      filePath = fileChoice.path;
    }
  }

  if (!filePath) {
    filePath = await promptInput({
      label: 'Challenge file path',
      description:
        'Use the JSON file created by the save-challenge step. It contains the exact invoice, macaroon, and paid URL for one challenge attempt.',
    });
  }

  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = parseJson(raw);
  if (!parsed) {
    throw new Error('Challenge file does not contain valid JSON.');
  }

  const bundle = normalizeChallengeBundle(parsed, {
    ...defaults,
    sourceFile: filePath,
  });

  spacer();
  printBlock(success(`Loaded challenge file ${formatPathForDisplay(filePath)}`));
  return bundle;
}

async function promptManualChallengeBundle(defaults = {}) {
  spacer();
  printBlock(subheading('Paste earlier challenge details'));
  printList([
    'Use the exact invoice, macaroon, and paid URL from the earlier challenge you want to resume.',
    'Do not mix an invoice from one challenge with the macaroon from another.',
  ]);

  const baseUrl = trimTrailingSlash(
    await promptInput({
      label: 'Base URL',
      description:
        'Use the host that originally returned the challenge. The default is the live paywall host.',
      defaultValue: defaults.baseUrl ?? DEFAULT_BASE_URL,
      validate: (value) => {
        try {
          const parsed = new URL(value);
          if (!/^https?:$/.test(parsed.protocol)) {
            return 'Use an http or https URL.';
          }
          return null;
        } catch {
          return 'Please enter a valid URL.';
        }
      },
    }),
  );

  const paidUrl = normalizePaidUrl(
    await promptInput({
      label: 'Paid URL',
      description:
        'Paste the exact paid URL from the earlier challenge. You can paste either the path or the full URL.',
      defaultValue: defaults.paidUrl ?? undefined,
      validate: (value) => {
        try {
          normalizePaidUrl(value, baseUrl);
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : 'Please enter a valid paid URL.';
        }
      },
    }),
    baseUrl,
  );

  const paidUrlMetadata = extractChallengeMetadataFromPaidUrl(paidUrl);
  let skillId = paidUrlMetadata.skillId || defaults.skillId || '';
  if (!skillId) {
    skillId = await promptInput({
      label: 'Skill ID',
      description:
        'Where to get this: use the skill identifier from the original manifest or paid URL.',
      defaultValue: DEFAULT_SKILL_ID,
    });
  }

  const invoice = await promptInput({
    label: 'Invoice',
    description:
      'Paste the exact BOLT11 invoice from the earlier challenge.',
    validate: (value) =>
      isLikelyBolt11Invoice(value) ? null : 'Invoice must be a BOLT11 invoice beginning with ln.',
  });

  const macaroon = await promptInput({
    label: 'Macaroon',
    description:
      'Paste the exact macaroon returned with that same invoice challenge. This value can be long.',
  });

  return normalizeChallengeBundle(
    {
      baseUrl,
      skillId,
      title: defaults.title ?? null,
      priceSats: defaults.priceSats ?? null,
      contentSha256: defaults.contentSha256 ?? paidUrlMetadata.contentSha256,
      paidUrl,
      invoice,
      macaroon,
      scheme: 'L402',
    },
    defaults,
  );
}

async function unlockPaidContent(bundle) {
  printChallengeBundle(bundle, 'Challenge you are using');

  const actionOptions = [
    {
      label: 'Enter the payment preimage now',
      description: 'Use this only if the preimage comes from the exact invoice shown above.',
      value: 'enter',
      recommended: true,
    },
  ];

  if (bundle.sourceFile) {
    actionOptions.push({
      label: 'Return to the main menu',
      description: `You can reopen ${formatPathForDisplay(bundle.sourceFile)} later.`,
      value: 'back',
    });
  } else {
    actionOptions.push({
      label: 'Save this challenge for later',
      description: 'Write the invoice, macaroon, and paid URL to a file, then return to the main menu.',
      value: 'save',
    });
    actionOptions.push({
      label: 'Return to the main menu without saving',
      description: 'Only do this if you already stored the challenge details somewhere else.',
      value: 'back',
    });
  }

  const nextAction = await promptChoice({
    label: 'What do you want to do next?',
    description:
      'Make sure the preimage you use comes from this exact invoice. Mixing challenge attempts will fail.',
    options: actionOptions,
  });

  if (nextAction === 'save') {
    await offerChallengeSave(bundle);
    return;
  }

  if (nextAction === 'back') {
    return;
  }

  const preimage = (
    await promptSecret({
      label: 'Payment preimage',
      description:
        'Paste the 64-character hex preimage returned by your payer. This input is hidden in an interactive terminal.',
      validate: (value) =>
        isHex64(value) ? null : 'The preimage must be a 64-character hex string.',
    })
  ).toLowerCase();

  const authorization = `${bundle.scheme} ${bundle.macaroon}:${preimage}`;
  const contentResponse = await fetchAuthorizedContent(
    bundle.baseUrl,
    bundle.paidUrl,
    authorization,
  );

  spacer();
  printBlock(subheading('Authorized content request'));
  printList([
    `HTTP status: ${contentResponse.status}`,
    `content-type: ${contentResponse.headers['content-type'] ?? '<missing>'}`,
    `etag: ${contentResponse.headers.etag ?? '<missing>'}`,
    `x-skill-version: ${contentResponse.headers['x-skill-version'] ?? '<missing>'}`,
  ]);

  if (contentResponse.status !== 200) {
    printBlock(danger('The authorized request did not succeed.'));
    printBlock(contentResponse.body || '<empty>');

    if (contentResponse.status === 402) {
      const newChallenge = parseChallenges(contentResponse.headers['www-authenticate']).find(
        (item) => item.scheme === 'L402',
      );

      if (newChallenge) {
        spacer();
        printBlock(warning('The server returned a new payment challenge.'));
        printList([
          'This usually means the preimage belongs to a different invoice than the macaroon challenge you submitted.',
          `Submitted invoice: ${bundle.invoice}`,
          `Returned invoice: ${newChallenge.invoice}`,
        ]);
        printBlock(
          dim('Use the resume workflow with the original invoice and macaroon pair that matches this preimage.'),
        );
      }
    }

    return;
  }

  spacer();
  printBlock(success('Paid content unlocked successfully.'));
  printBlock(previewContent(contentResponse.body));
  if (contentResponse.body.split('\n').length > MAX_PREVIEW_LINES) {
    printBlock(dim('Preview truncated. You can print or save the full markdown next.'));
  }

  const afterSuccess = await promptChoice({
    label: 'What do you want to do with the paid markdown?',
    options: [
      {
        label: 'Save it to a file',
        description: 'Write the full markdown to disk.',
        value: 'save',
        recommended: true,
      },
      {
        label: 'Print the full markdown in the terminal',
        description: 'Show the complete body immediately.',
        value: 'print',
      },
      {
        label: 'Return to the main menu',
        description: 'Stop after the successful verification.',
        value: 'done',
      },
    ],
  });

  if (afterSuccess === 'print') {
    spacer();
    printBlock(contentResponse.body);
    return;
  }

  if (afterSuccess === 'save') {
    const suggestedPath = path.resolve(process.cwd(), `${bundle.skillId}.md`);
    const outputPath = await promptInput({
      label: 'Output file path',
      description:
        'Where to get this: choose any writable path on your machine. The default writes into the current working directory.',
      defaultValue: suggestedPath,
    });

    await fs.writeFile(outputPath, contentResponse.body, 'utf8');
    spacer();
    printBlock(success(`Saved paid markdown to ${outputPath}`));
  }
}

async function resumeChallengeFlow(defaults = {}) {
  spacer();
  printBlock(subheading('Resume a saved invoice or prior challenge'));
  printList([
    'Use this when you already have an earlier invoice and macaroon and want to unlock content without minting a fresh challenge.',
    'The invoice, macaroon, and payment preimage must all come from the same challenge attempt.',
  ]);

  const source = await promptChoice({
    label: 'Where do you want to load the challenge from?',
    options: [
      {
        label: 'Load a saved challenge file',
        description: 'Best if you previously saved the challenge in this CLI.',
        value: 'file',
        recommended: true,
      },
      {
        label: 'Paste the earlier challenge details manually',
        description: 'Use this if you copied the invoice, macaroon, and paid URL somewhere else.',
        value: 'manual',
      },
      {
        label: 'Return to the main menu',
        description: 'Do nothing else.',
        value: 'back',
      },
    ],
  });

  if (source === 'back') {
    return;
  }

  const bundle =
    source === 'file'
      ? await loadSavedChallengeBundle(defaults)
      : await promptManualChallengeBundle(defaults);

  if (!bundle) {
    return;
  }

  await unlockPaidContent(bundle);
}

async function accessFlow({ baseUrl = DEFAULT_BASE_URL, skillId = DEFAULT_SKILL_ID } = {}) {
  spacer();
  printBlock(subheading('Access a live paid skill'));
  printList([
    'This flow fetches the public manifest, requests the paid route, and then helps you complete the L402 payment and retry.',
    `Use ${DEFAULT_BASE_URL} unless you deployed another paywall host.`,
    `Use ${DEFAULT_SKILL_ID} if you just want to test the live service right now.`,
    'No admin token is required for this flow.',
  ]);

  const resolvedBaseUrl = trimTrailingSlash(
    await promptInput({
      label: 'Base URL',
      description:
        'Where to get this: use the live host above unless you deployed the paywall somewhere else.',
      defaultValue: baseUrl,
      validate: (value) => {
        try {
          const parsed = new URL(value);
          if (!/^https?:$/.test(parsed.protocol)) {
            return 'Use an http or https URL.';
          }
          return null;
        } catch {
          return 'Please enter a valid URL.';
        }
      },
    }),
  );

  const skillChoice = await promptChoice({
    label: 'Which skill do you want to access?',
    description:
      'If you only want to test the service, use the currently published live skill. If you already know another public skill ID, enter it instead.',
    options: [
      {
        label: `Use ${DEFAULT_SKILL_ID}`,
        description: 'Best for a first run against the live host.',
        value: DEFAULT_SKILL_ID,
        recommended: true,
      },
      {
        label: 'Enter another skill ID',
        description:
          'Use this if you want to test a different public skill.',
        value: '__custom__',
      },
    ],
  });

  const resolvedSkillId =
    skillChoice === '__custom__'
      ? await promptInput({
          label: 'Skill ID',
          description:
            'Where to get this: it is the same identifier used in the manifest URL and in the publish payload. Example: lightning-desktop-live-local-lnd',
          defaultValue: skillId,
        })
      : skillChoice;

  const manifestResponse = await fetchManifest(resolvedBaseUrl, resolvedSkillId);
  if (manifestResponse.status !== 200 || !manifestResponse.json) {
    spacer();
    printBlock(danger('Unable to fetch the public manifest.'));
    printList([
      `HTTP status: ${manifestResponse.status}`,
      `Response body: ${manifestResponse.body || '<empty>'}`,
    ]);
    return;
  }

  const manifest = manifestResponse.json;
  summarizeManifest(manifest);

  const nextStep = await promptChoice({
    label: 'What do you want to do next?',
    options: [
      {
        label: 'Request the payment challenge',
        description:
          'This will hit the protected route and capture the invoice and L402 macaroon.',
        value: 'challenge',
        recommended: true,
      },
      {
        label: 'Resume a previous invoice or challenge for this skill',
        description:
          'Use a saved challenge file or paste the earlier invoice, macaroon, and paid URL manually.',
        value: 'resume',
      },
      {
        label: 'Return to the main menu',
        description: 'Stop here after the manifest lookup.',
        value: 'back',
      },
    ],
  });

  if (nextStep === 'back') {
    return;
  }

  if (nextStep === 'resume') {
    await resumeChallengeFlow({
      baseUrl: resolvedBaseUrl,
      skillId: resolvedSkillId,
      title: manifest.title,
      priceSats: manifest.price_sats,
      contentSha256: manifest.content_sha256,
      paidUrl: manifest.paid_url,
    });
    return;
  }

  const challengeResponse = await fetchChallenge(resolvedBaseUrl, manifest.paid_url);
  const challenges = parseChallenges(challengeResponse.headers['www-authenticate']);
  const l402Challenge = challenges.find((item) => item.scheme === 'L402');

  spacer();
  printBlock(subheading('Protected route response'));
  printList([
    `HTTP status: ${challengeResponse.status}`,
    `Body: ${challengeResponse.body || '<empty>'}`,
  ]);

  if (challengeResponse.status !== 402 || !l402Challenge) {
    printBlock(
      danger(
        'The protected route did not return the expected L402 challenge. Check the response above.',
      ),
    );
    return;
  }

  summarizeChallenge(challengeResponse, l402Challenge);

  const challengeBundle = normalizeChallengeBundle({
    baseUrl: resolvedBaseUrl,
    skillId: resolvedSkillId,
    title: manifest.title,
    priceSats: manifest.price_sats,
    contentSha256: manifest.content_sha256,
    paidUrl: manifest.paid_url,
    invoice: l402Challenge.invoice,
    macaroon: l402Challenge.macaroon,
    scheme: l402Challenge.scheme,
    capturedAt: new Date().toISOString(),
  });

  const paymentMethod = await promptChoice({
    label: 'How do you want to get the payment preimage?',
    description:
      'The manual paid-content request requires the preimage from the payment that settles the invoice.',
    options: [
      {
        label: 'Pay with lncli and paste the preimage',
        description:
          'Best if you control an LND node. lncli can pay the invoice and return payment_preimage directly.',
        value: 'lncli',
        recommended: true,
      },
      {
        label: 'Pay with another wallet that exposes the preimage',
        description:
          'Use this if your wallet shows advanced payment details including the preimage.',
        value: 'wallet',
      },
      {
        label: 'Save this challenge for later',
        description:
          'Capture the exact invoice, macaroon, and paid URL in a file so you can resume later.',
        value: 'save-later',
      },
      {
        label: 'Show operator-only QA shortcut instructions',
        description:
          'Only for the node operator. This is not the same as a real end-user payment.',
        value: 'operator',
      },
    ],
  });

  if (paymentMethod === 'save-later') {
    await pauseChallengeForLater(challengeBundle);
    return;
  }

  if (paymentMethod === 'lncli') {
    spacer();
    printBlock(subheading('lncli payment instructions'));
    printList([
      'Run the command below in a shell where lncli is already configured for the paying node.',
      'After the payment completes, copy the payment_preimage field exactly as returned.',
      'It should be a 64-character hex string.',
    ]);
    printBlock('');
    printBlock(`PAYMENT_JSON=$(lncli payinvoice --force --json "${l402Challenge.invoice}")`);
    printBlock('echo "$PAYMENT_JSON" | jq');
    printBlock('echo "$PAYMENT_JSON" | jq -r \'.payment_preimage\'');
  }

  if (paymentMethod === 'wallet') {
    spacer();
    printBlock(subheading('External wallet instructions'));
    printList([
      'Pay the invoice using a wallet that exposes advanced payment details.',
      'Look for a field named payment preimage, preimage, or secret after the payment settles.',
      'The CLI expects a 64-character hex string.',
      'If your wallet does not expose the preimage, use lncli or another tool for manual QA.',
    ]);
    printBlock('');
    printBlock(`Invoice to pay: ${l402Challenge.invoice}`);
  }

  if (paymentMethod === 'operator') {
    spacer();
    printBlock(subheading('Operator-only QA shortcut'));
    printList([
      'This only works if you control the issuing LND node.',
      'You can look up the invoice on the issuing node and read r_preimage.',
      'This verifies the service path, but it is not a substitute for a real external payment test.',
    ]);
    printBlock('');
    printBlock('You need:');
    printList([
      'the payment hash from the L402 macaroon identifier',
      'access to the issuing node REST API',
      'a macaroon with invoice read access',
    ]);
  }

  await unlockPaidContent(challengeBundle);
}

async function chooseMarkdownSource(repoRoot) {
  const discovered = await discoverSkillFiles(repoRoot);
  const options = [];

  if (discovered.length > 0) {
    for (const file of discovered.slice(0, 6)) {
      options.push({
        label: `Use ${path.relative(repoRoot, file)}`,
        description:
          'Good if you already have a markdown skill file checked into the repo.',
        value: { type: 'file', path: file },
        recommended: file.endsWith(`${DEFAULT_SKILL_ID}/SKILL.md`),
      });
    }
  }

  options.push({
    label: 'Enter another markdown file path',
    description:
      'Use a local file that already contains the markdown you want to publish.',
    value: { type: 'custom-file' },
  });
  options.push({
    label: 'Paste markdown directly',
    description: 'Use this if you want to type or paste the content in the terminal.',
    value: { type: 'paste' },
  });

  return promptChoice({
    label: 'Where should the markdown come from?',
    options,
  });
}

async function readPastedMarkdown() {
  spacer();
  printBlock(heading('Paste markdown content'));
  printBlock(
    dim(
      'Paste the full markdown now. Finish by entering a line that contains only END on its own.',
    ),
  );

  const lines = [];
  while (true) {
    const line = await rl.question('');
    if (line === 'END') {
      break;
    }
    lines.push(line);
  }

  return lines.join('\n');
}

async function publishFlow(repoRoot) {
  spacer();
  printBlock(subheading('Operator-only publish flow'));
  printList([
    'This flow sends markdown to POST /api/admin/publish-skill and then lets you continue into the L402 access flow.',
    'This is optional and only needed if you operate the paywall.',
    'It requires the ADMIN_PUBLISH_TOKEN from the Vercel project lightning-terminal-paywall.',
  ]);

  const baseUrl = trimTrailingSlash(
    await promptInput({
      label: 'Base URL',
      description:
        'Use the live paywall host unless you deployed another copy.',
      defaultValue: DEFAULT_BASE_URL,
      validate: (value) => {
        try {
          new URL(value);
          return null;
        } catch {
          return 'Please enter a valid URL.';
        }
      },
    }),
  );

  spacer();
  printBlock(subheading('How to acquire the admin publish token'));
  printList([
    'Open the Vercel dashboard for brianmurray333s-projects/lightning-terminal-paywall.',
    'Go to Settings > Environment Variables.',
    'Find ADMIN_PUBLISH_TOKEN in the Production environment.',
    'Copy the secret value, then paste it below.',
  ]);

  const adminToken = await promptSecret({
    label: 'ADMIN_PUBLISH_TOKEN',
    description:
      'This is a secret bearer token. Input is hidden in an interactive terminal.',
  });

  const source = await chooseMarkdownSource(repoRoot);

  let content = '';
  let filePath = '';
  let frontmatter = {};
  let titleHint = '';

  if (source.type === 'file') {
    filePath = source.path;
  } else if (source.type === 'custom-file') {
    filePath = await promptInput({
      label: 'Markdown file path',
      description:
        'Where to get this: use an existing .md file on disk. If it has frontmatter with name or description, the CLI will use that as a hint.',
    });
  }

  if (filePath) {
    const loaded = await loadMarkdownFile(filePath);
    content = loaded.content;
    frontmatter = loaded.frontmatter;
    titleHint = loaded.title;

    spacer();
    printBlock(success(`Loaded ${filePath}`));
    if (frontmatter.name || frontmatter.description || titleHint) {
      printList([
        `frontmatter name: ${frontmatter.name ?? '<missing>'}`,
        `frontmatter description: ${frontmatter.description ?? '<missing>'}`,
        `first heading: ${titleHint || '<missing>'}`,
      ]);
    }
  } else {
    content = await readPastedMarkdown();
    frontmatter = parseFrontmatter(content);
    titleHint = firstMarkdownHeading(content);
  }

  const fallbackSkillId =
    frontmatter.name ||
    (filePath ? path.basename(path.dirname(filePath)) : DEFAULT_SKILL_ID);
  const fallbackTitle = titleHint || fallbackSkillId;
  const fallbackSummary =
    frontmatter.description || 'Short public description of the paid skill.';

  const skillId = await promptInput({
    label: 'Skill ID',
    description:
      'Where to get this: use the stable identifier clients will request. If you are publishing a new version of an existing skill, reuse the same skill ID.',
    defaultValue: fallbackSkillId,
  });

  const title = await promptInput({
    label: 'Title',
    description:
      'Where to get this: use the first markdown heading or the human-friendly display title you want shown in the manifest.',
    defaultValue: fallbackTitle,
  });

  const summary = await promptInput({
    label: 'Summary',
    description:
      'Where to get this: use a short public description. If your markdown file has frontmatter description, it is usually a good starting point.',
    defaultValue: fallbackSummary,
  });

  const priceSats = Number.parseInt(
    await promptInput({
      label: 'Price in sats',
      description:
        'Use a positive integer between 1 and 100000. The current live skill uses 21 sats.',
      defaultValue: DEFAULT_PRICE_SATS,
      validate: (value) => {
        if (!isPositiveIntegerString(value)) {
          return 'Enter a positive integer.';
        }
        const parsed = Number.parseInt(value, 10);
        if (parsed < 1 || parsed > 100000) {
          return 'The current configured range is 1 to 100000 sats.';
        }
        return null;
      },
    }),
    10,
  );

  spacer();
  printBlock(subheading('Publish summary'));
  printList([
    `base URL: ${baseUrl}`,
    `skill ID: ${skillId}`,
    `title: ${title}`,
    `summary: ${summary}`,
    `price: ${priceSats} sats`,
    `content length: ${content.length} characters`,
  ]);

  const confirm = await promptChoice({
    label: 'Publish this skill version now?',
    options: [
      {
        label: 'Yes, publish it',
        description: 'Send the payload to the live paywall service now.',
        value: 'yes',
        recommended: true,
      },
      {
        label: 'No, cancel this publish flow',
        description: 'Return to the main menu without making changes.',
        value: 'no',
      },
    ],
  });

  if (confirm === 'no') {
    return;
  }

  const publishResponse = await publishSkill(baseUrl, adminToken, {
    skillId,
    title,
    summary,
    priceSats,
    content,
  });

  spacer();
  printBlock(subheading('Publish response'));
  printList([
    `HTTP status: ${publishResponse.status}`,
    `Body: ${publishResponse.body || '<empty>'}`,
  ]);

  if (publishResponse.status !== 200 || !publishResponse.json) {
    printBlock(danger('Publish failed. Check the response body above.'));
    return;
  }

  const manifest = publishResponse.json;
  summarizeManifest(manifest);

  const next = await promptChoice({
    label: 'What do you want to do next?',
    options: [
      {
        label: 'Continue into the paid-access test for this skill',
        description: 'Immediately request the challenge and walk through payment.',
        value: 'test',
        recommended: true,
      },
      {
        label: 'Return to the main menu',
        description: 'Stop after publishing.',
        value: 'back',
      },
    ],
  });

  if (next === 'test') {
    await accessFlow({ baseUrl, skillId: manifest.skill_id });
  }
}

async function inspectFlow() {
  spacer();
  printBlock(subheading('Inspect the live service'));

  const baseUrl = trimTrailingSlash(
    await promptInput({
      label: 'Base URL',
      description:
        'Use the current live host unless you deployed another paywall somewhere else.',
      defaultValue: DEFAULT_BASE_URL,
      validate: (value) => {
        try {
          new URL(value);
          return null;
        } catch {
          return 'Please enter a valid URL.';
        }
      },
    }),
  );

  const action = await promptChoice({
    label: 'What do you want to inspect?',
    options: [
      {
        label: 'Check the homepage and the current live manifest',
        description: 'Best overview of what is live right now.',
        value: 'homepage+manifest',
        recommended: true,
      },
      {
        label: 'Fetch only the current live manifest',
        description: `Uses ${DEFAULT_SKILL_ID} by default.`,
        value: 'manifest',
      },
      {
        label: 'Return to the main menu',
        description: 'Do nothing else.',
        value: 'back',
      },
    ],
  });

  if (action === 'back') {
    return;
  }

  if (action === 'homepage+manifest') {
    const homepage = await requestRaw(baseUrl);
    spacer();
    printBlock(subheading('Homepage check'));
    printList([
      `HTTP status: ${homepage.status}`,
      `content-type: ${homepage.headers['content-type'] ?? '<missing>'}`,
    ]);
  }

  const manifest = await fetchManifest(baseUrl, DEFAULT_SKILL_ID);
  spacer();
  printBlock(subheading('Current live manifest'));
  printList([
    `HTTP status: ${manifest.status}`,
    `Body: ${manifest.body || '<empty>'}`,
  ]);
}

async function main() {
  const repoRoot = process.cwd();

  spacer();
  printBlock(heading('Lightning L402 Walkthrough CLI'));
  printBlock(
    dim(
      'This helper walks you through the live paywall at https://l402.lightningnode.app step by step.',
    ),
  );

  while (true) {
    const action = await promptChoice({
      label: 'Choose a workflow',
      options: [
        {
          label: 'Access a live paid skill',
          description:
            'Fetch the manifest, capture the payment challenge, and complete the authorized content request.',
          value: 'access',
          recommended: true,
        },
        {
          label: 'Resume a saved invoice or prior challenge',
          description:
            'Use this when you already have the exact invoice and macaroon from an earlier challenge attempt.',
          value: 'resume',
        },
        {
          label: 'Operator only: publish a skill',
          description:
            'Optional tooling for operators who already have the publish token.',
          value: 'publish',
        },
        {
          label: 'Inspect the live service',
          description: 'Check the homepage and current public manifest without doing a payment flow.',
          value: 'inspect',
        },
        {
          label: 'Exit',
          description: 'Quit the walkthrough CLI.',
          value: 'exit',
        },
      ],
    });

    try {
      if (action === 'access') {
        await accessFlow();
      } else if (action === 'resume') {
        await resumeChallengeFlow();
      } else if (action === 'publish') {
        await publishFlow(repoRoot);
      } else if (action === 'inspect') {
        await inspectFlow();
      } else {
        spacer();
        printBlock(success('Goodbye.'));
        break;
      }
    } catch (error) {
      spacer();
      printBlock(danger(`Error: ${error instanceof Error ? error.message : String(error)}`));
    }

    await promptEnterToContinue();
  }
}

process.on('SIGINT', () => {
  spacer();
  printBlock(warning('Cancelled.'));
  rl.close();
  process.exit(130);
});

main()
  .catch((error) => {
    spacer();
    printBlock(danger(`Fatal error: ${error instanceof Error ? error.message : String(error)}`));
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
  });
