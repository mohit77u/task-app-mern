import { RoleCode } from '../../common/enums/role-code';
import { TaskStatus as S } from '../../common/enums/task-status';
import {
  allowedTargets,
  evaluateTransition,
  TRANSITION_RULES,
} from './task-state-machine';

const ALL = Object.values(S);

/** The workflow written out independently of the implementation: pair -> who may do it and whether a note is required. */
const EXPECTED_RULES: Record<
  string,
  { actor: 'EMPLOYEE' | 'ADMIN'; note: boolean }
> = {
  'PENDING>IN_PROGRESS': { actor: 'EMPLOYEE', note: false },
  'IN_PROGRESS>PENDING_APPROVAL': { actor: 'EMPLOYEE', note: false },
  'PENDING_APPROVAL>COMPLETED': { actor: 'ADMIN', note: false },
  'PENDING_APPROVAL>IN_PROGRESS': { actor: 'ADMIN', note: true },
};

const VIEWERS: Array<[RoleCode, boolean]> = [
  [RoleCode.ADMIN, false],
  [RoleCode.ADMIN, true],
  [RoleCode.EMPLOYEE, true],
  [RoleCode.EMPLOYEE, false],
];

type Case = [RoleCode, boolean, S, S, string | undefined, string];

/** Every (role, isAssignee, from, to) combination, with and without a note, and the decision it must produce. */
const CASES: Case[] = VIEWERS.flatMap(([role, isAssignee]) =>
  ALL.flatMap((from) =>
    ALL.flatMap((to) =>
      [undefined, 'Needs more detail'].map((note): Case => {
        const rule = EXPECTED_RULES[`${from}>${to}`];
        let expected: string;
        if (!rule) expected = 'INVALID_TRANSITION';
        else if (
          rule.actor === 'ADMIN'
            ? role !== RoleCode.ADMIN
            : role !== RoleCode.EMPLOYEE || !isAssignee
        )
          expected = 'FORBIDDEN';
        else if (rule.note && !note) expected = 'NOTE_REQUIRED';
        else expected = 'ALLOWED';
        return [role, isAssignee, from, to, note, expected];
      }),
    ),
  ),
);

describe('TRANSITION_RULES', () => {
  it('is exactly the documented table', () => {
    expect(
      Object.fromEntries(
        TRANSITION_RULES.map((r) => [
          `${r.from}>${r.to}`,
          {
            actor: r.actor === 'ADMIN' ? 'ADMIN' : 'EMPLOYEE',
            note: r.noteRequired,
          },
        ]),
      ),
    ).toEqual(EXPECTED_RULES);
  });
});

describe('evaluateTransition', () => {
  it.each(CASES)(
    'role=%s isAssignee=%s %s -> %s note=%s => %s',
    (role, isAssignee, from, to, note, expected) => {
      expect(evaluateTransition({ role, isAssignee, from, to, note })).toEqual(
        expected === 'ALLOWED'
          ? { allowed: true }
          : { allowed: false, reason: expected },
      );
    },
  );

  it('an Admin who is not the assignee cannot do the employee steps', () => {
    for (const [from, to] of [
      [S.PENDING, S.IN_PROGRESS],
      [S.IN_PROGRESS, S.PENDING_APPROVAL],
    ] as const) {
      expect(
        evaluateTransition({
          role: RoleCode.ADMIN,
          isAssignee: false,
          from,
          to,
        }),
      ).toEqual({ allowed: false, reason: 'FORBIDDEN' });
    }
  });

  it('an Employee never approves or rejects, even as the assignee', () => {
    for (const to of [S.COMPLETED, S.IN_PROGRESS]) {
      expect(
        evaluateTransition({
          role: RoleCode.EMPLOYEE,
          isAssignee: true,
          from: S.PENDING_APPROVAL,
          to,
          note: 'x',
        }),
      ).toEqual({ allowed: false, reason: 'FORBIDDEN' });
    }
  });

  it.each([undefined, null, '', '   '])(
    'reject with note %p is NOTE_REQUIRED',
    (note) => {
      expect(
        evaluateTransition({
          role: RoleCode.ADMIN,
          isAssignee: false,
          from: S.PENDING_APPROVAL,
          to: S.IN_PROGRESS,
          note,
        }),
      ).toEqual({ allowed: false, reason: 'NOTE_REQUIRED' });
    },
  );

  it('never allows leaving COMPLETED', () => {
    for (const [role, isAssignee] of VIEWERS) {
      for (const to of ALL) {
        expect(
          evaluateTransition({
            role,
            isAssignee,
            from: S.COMPLETED,
            to,
            note: 'x',
          }),
        ).toEqual({ allowed: false, reason: 'INVALID_TRANSITION' });
      }
    }
  });
});

describe('allowedTargets', () => {
  const table: Array<[RoleCode, boolean, S, S[]]> = [
    [RoleCode.EMPLOYEE, true, S.PENDING, [S.IN_PROGRESS]],
    [RoleCode.EMPLOYEE, true, S.IN_PROGRESS, [S.PENDING_APPROVAL]],
    [RoleCode.EMPLOYEE, true, S.PENDING_APPROVAL, []],
    [RoleCode.EMPLOYEE, true, S.COMPLETED, []],
    [RoleCode.EMPLOYEE, false, S.PENDING, []],
    [RoleCode.EMPLOYEE, false, S.IN_PROGRESS, []],
    [RoleCode.ADMIN, false, S.PENDING, []],
    [RoleCode.ADMIN, false, S.IN_PROGRESS, []],
    [RoleCode.ADMIN, false, S.PENDING_APPROVAL, [S.COMPLETED, S.IN_PROGRESS]],
    [RoleCode.ADMIN, false, S.COMPLETED, []],
  ];
  it.each(table)(
    'role=%s isAssignee=%s from %s -> %p',
    (role, isAssignee, from, expected) => {
      expect(allowedTargets({ role, isAssignee }, from).sort()).toEqual(
        [...expected].sort(),
      );
    },
  );
});
