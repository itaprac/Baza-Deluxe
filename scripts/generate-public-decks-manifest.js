#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const outputPath = path.join(dataDir, 'public-decks-manifest.json');

function normalizeGroup(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeSelectionMode(value) {
  return value === 'single' || value === 'multiple' ? value : null;
}

function toPosInt(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
}

function buildEntry(filename) {
  const fullPath = path.join(dataDir, filename);
  const raw = fs.readFileSync(fullPath, 'utf8');
  const parsed = JSON.parse(raw);
  const deck = parsed && typeof parsed === 'object' ? parsed.deck : null;
  const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
  if (!deck || typeof deck !== 'object') {
    throw new Error(`Brak obiektu deck w pliku: ${filename}`);
  }
  if (typeof deck.id !== 'string' || deck.id.trim().length === 0) {
    throw new Error(`Brak poprawnego deck.id w pliku: ${filename}`);
  }

  const categories = Array.isArray(deck.categories) ? deck.categories : null;
  const group = normalizeGroup(deck.group);
  const questionCount = toPosInt(deck.questionCount, questions.length);

  const entry = {
    id: deck.id,
    file: `/data/${filename}`,
    name: String(deck.name || deck.id),
    description: String(deck.description || ''),
    questionCount,
    version: toPosInt(deck.version, 1),
  };
  if (group) entry.group = group;
  if (categories) entry.categories = categories;
  const defaultSelectionMode = normalizeSelectionMode(deck.defaultSelectionMode);
  if (defaultSelectionMode) entry.defaultSelectionMode = defaultSelectionMode;
  return entry;
}

function main() {
  const files = fs.readdirSync(dataDir)
    .filter((name) => name.endsWith('.json'))
    .filter((name) => name !== path.basename(outputPath))
    .sort();

  const manifest = files.map((filename) => buildEntry(filename));
  const payload = {
    generatedAt: new Date().toISOString(),
    decks: manifest,
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  process.stdout.write(`Wygenerowano ${outputPath} (${manifest.length} talii)\n`);
}

main();
