/**
 * Runtime Configuration Checksum Controller
 *
 * Exposes endpoints for operators to inspect runtime config checksums and safe settings.
 *
 * @module controllers/configController
 */

import {
  getRuntimeConfigChecksum,
  getSanitizedRuntimeConfig,
} from '../../services/runtimeConfigChecksumService.js';

/**
 * GET /api/config/checksum
 * Returns safe SHA-256 checksum and per-setting hashes for allowed configuration.
 */
export const getConfigChecksum = (req, res) => {
  const includeSettings = req.query.includeSettings === 'true';
  const data = getRuntimeConfigChecksum({ includeSettings });
  res.json(data);
};

/**
 * GET /api/config
 * Returns configuration overview including checksum, hashes, and masked settings.
 */
export const getRuntimeConfig = (req, res) => {
  const data = getRuntimeConfigChecksum({ includeSettings: true });
  res.json(data);
};

export default {
  getConfigChecksum,
  getRuntimeConfig,
};
