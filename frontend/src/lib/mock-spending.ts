import fixture from '../../../mock/safe-to-spend.json';
import type { RecurringItem, SavingsGoal } from './safe-to-spend';

export const spendingScenario = {
  ...fixture,
  recurring: fixture.recurring as RecurringItem[],
  goals: fixture.goals as SavingsGoal[],
};
