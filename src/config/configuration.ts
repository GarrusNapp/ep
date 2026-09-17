import bytes from 'bytes';
import { z } from 'zod';

const ms = z.coerce.number().int().positive();

// Accepts plain byte count ("536870912") or a humans readable size
// ("512MB", "1GB")
const size = z.string().transform((raw, ctx) => {
    const parsed = bytes.parse(raw);
    if (parsed === null || !Number.isFinite(parsed) || parsed <= 0) {
        ctx.addIssue({
            code: 'custom',
            message: `Invalid size "${raw}" — expected a byte count or a size like "512MB", "1GB"`,
        });
        return z.NEVER;
    }
    return Math.round(parsed);
});


const schema = z
    .object({
        PORT: z.coerce.number().int().min(1).max(65535),

        ALLOWED_TYPES: z
            .string()
            .transform((s) =>
                s
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean),
            )
            .pipe(z.array(z.string().regex(/^[a-z0-9_-]+$/)).nonempty()),

        ARCHIVE_AFTER_MS: ms,
        ARCHIVE_SWEEP_INTERVAL_MS: ms,
        ARCHIVE_BATCH_SIZE: z.coerce.number().int().positive().max(10_000),

        // Optional: use when the corresponding tier uses DiskFileStorage
        ARCHIVE_PATH: z.string().min(1).optional(),
        HOT_PATH: z.string().min(1).optional(),

        HOT_MAX_SIZE: size,
        MAX_FILE_SIZE: size,

        PAGE_SIZE_DEFAULT: z.coerce.number().int().positive(),
        PAGE_SIZE_MAX: z.coerce.number().int().positive(),
        EXISTS_BATCH_MAX: z.coerce.number().int().positive(),
    })
    .refine((c) => c.ARCHIVE_SWEEP_INTERVAL_MS < c.ARCHIVE_AFTER_MS, {
        message: 'ARCHIVE_SWEEP_INTERVAL_MS must be lower than ARCHIVE_AFTER_MS',
        path: ['ARCHIVE_SWEEP_INTERVAL_MS'],
    })
    .refine((c) => c.MAX_FILE_SIZE <= c.HOT_MAX_SIZE, {
        message: 'Individual file cannot exceed hot storage capacity',
        path: ['MAX_FILE_SIZE'],
    })
    .refine((c) => c.PAGE_SIZE_DEFAULT <= c.PAGE_SIZE_MAX, {
        message: 'PAGE_SIZE_DEFAULT must not exceed PAGE_SIZE_MAX',
        path: ['PAGE_SIZE_DEFAULT'],
    });

export type AppConfigShape = z.infer<typeof schema>;

export function loadConfig(
    env: NodeJS.ProcessEnv = process.env,
): AppConfigShape {
    const result = schema.safeParse(env);
    if (!result.success) {
        const issues = result.error.issues
            .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
            .join('\n');
        throw new Error(`Invalid configuration:\n${issues}`);
    }
    return result.data;
}
