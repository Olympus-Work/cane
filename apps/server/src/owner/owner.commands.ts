import { Command, CommandRunner, Option } from 'nest-commander';
import { AuthService } from '../auth/auth.service.js';
import type { TotpEnrolment } from '../auth/auth.service.js';

interface SeedOptions {
  email?: string;
}

function ownerPassword(): string {
  const password = process.env.CANE_OWNER_PASSWORD;
  if (!password) throw new Error('Set CANE_OWNER_PASSWORD (min 12 characters)');
  return password;
}

/** Prints the TOTP enrolment and recovery codes; the only place they are shown. */
function printEnrolment(enrolment: TotpEnrolment, recoveryCodes: string[]): void {
  process.stdout.write('Scan this in your authenticator app:\n');
  process.stdout.write(`${enrolment.uri}\n`);
  process.stdout.write(`Or enter this secret manually: ${enrolment.secret}\n`);
  process.stdout.write('\n');
  process.stdout.write('Recovery codes (shown once, store them offline):\n');
  for (const code of recoveryCodes) process.stdout.write(`  ${code}\n`);
}

@Command({ name: 'seed-owner', description: 'Create the single owner account (first run only)' })
export class SeedOwnerCommand extends CommandRunner {
  constructor(private readonly auth: AuthService) {
    super();
  }

  override async run(_args: string[], options: SeedOptions): Promise<void> {
    if (!options.email) throw new Error('--email is required');
    const result = await this.auth.seedOwner(options.email, ownerPassword());
    if (result === 'exists') {
      process.stderr.write('owner already exists (use reset-password or reset-totp)\n');
      process.exitCode = 1;
      return;
    }
    if (result === 'weak_password') {
      process.stderr.write('password must be at least 12 characters\n');
      process.exitCode = 1;
      return;
    }
    printEnrolment(result.enrolment, result.recoveryCodes);
  }

  @Option({ flags: '--email <email>', description: 'Owner account email' })
  parseEmail(value: string): string {
    return value;
  }
}

@Command({ name: 'reset-password', description: 'Set a new owner password and sign out every session' })
export class ResetPasswordCommand extends CommandRunner {
  constructor(private readonly auth: AuthService) {
    super();
  }

  override async run(_args: string[]): Promise<void> {
    const result = await this.auth.resetPassword(ownerPassword());
    if (result === 'no_owner') {
      process.stderr.write('no owner account yet (run seed-owner)\n');
      process.exitCode = 1;
      return;
    }
    if (result === 'weak_password') {
      process.stderr.write('password must be at least 12 characters\n');
      process.exitCode = 1;
      return;
    }
    process.stdout.write('password reset; all sessions signed out\n');
  }
}

@Command({ name: 'reset-totp', description: 'Issue a new authenticator secret and recovery codes, and sign out every session' })
export class ResetTotpCommand extends CommandRunner {
  constructor(private readonly auth: AuthService) {
    super();
  }

  override async run(_args: string[]): Promise<void> {
    const result = await this.auth.resetTotp();
    if (result === 'no_owner') {
      process.stderr.write('no owner account yet (run seed-owner)\n');
      process.exitCode = 1;
      return;
    }
    printEnrolment(result.enrolment, result.recoveryCodes);
  }
}
