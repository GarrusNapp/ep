import { AppConfigShape } from './configuration.js';

export abstract class AppConfig implements AppConfigShape {
  abstract readonly PORT: number;
  abstract readonly ALLOWED_TYPES: [string, ...string[]]; //at least one

  abstract readonly ARCHIVE_AFTER_MS: number;
  abstract readonly ARCHIVE_SWEEP_INTERVAL_MS: number;
  abstract readonly ARCHIVE_BATCH_SIZE: number;
  abstract readonly ARCHIVE_PATH?: string;
  abstract readonly HOT_PATH?: string;

  abstract readonly HOT_MAX_SIZE: number;
  abstract readonly MAX_FILE_SIZE: number;

  abstract readonly PAGE_SIZE_DEFAULT: number;
  abstract readonly PAGE_SIZE_MAX: number;
  abstract readonly EXISTS_BATCH_MAX: number;
}
