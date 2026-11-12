// Types for passwords.mjs, which the sign-up page imports too.
export type PasswordPolicy = 'basic' | 'strong';
export type PasswordProblem = null | 'long' | 'short' | 'upper' | 'lower' | 'digit' | 'special' | 'email' | 'pattern' | 'common' | 'personal' | 'guessable';
export type PasswordRule = 'length' | 'upper' | 'lower' | 'digit' | 'special';
export const POLICIES: Record<PasswordPolicy, { min: number; upper: boolean; lower: boolean; digit: boolean; special: boolean; deep: boolean }>;
export function passwordCheck(pw: string, who?: { email?: string; name?: string }, policy?: PasswordPolicy): {
  score: 0 | 1 | 2 | 3 | 4; problem: PasswordProblem; rules: { id: PasswordRule; ok: boolean }[]; min: number; bits: number;
};
