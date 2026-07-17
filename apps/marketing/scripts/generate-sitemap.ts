#!/usr/bin/env bun
import path from 'node:path';

import { buildMarketingSitemap } from '../app/lib/sitemap';

const outputPath = path.resolve(import.meta.dir, '../public/sitemap.xml');

await Bun.write(outputPath, buildMarketingSitemap());
console.log(`Generated ${path.relative(process.cwd(), outputPath)}`);
