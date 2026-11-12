// Remove the previous JavaScript build so old hashed chunks don't pile up in public/.
import { rmSync } from 'node:fs';
rmSync('public/assets/js', { recursive: true, force: true });
