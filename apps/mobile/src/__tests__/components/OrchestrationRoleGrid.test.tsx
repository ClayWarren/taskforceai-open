import { render } from '@testing-library/react-native';

import { OrchestrationRoleGrid } from '../../components/OrchestrationRoleGrid';

jest.mock('../../components/Icon', () => require('../helpers/mock-modules').createIconMockModule());

describe('OrchestrationRoleGrid', () => {
  it('marks subscription-only role models as locked for free users', async () => {
    const { getByTestId } = await render(
      <OrchestrationRoleGrid
        models={[{ id: 'premium', label: 'Premium', badge: 'Pro', usageMultiple: 2 }]}
        roleModels={{ Researcher: 'premium' }}
        defaultModelId="premium"
        agentCount={1}
        expandedRole="Researcher"
        onRolePress={jest.fn()}
        onRoleModelChange={jest.fn()}
        userPlan="free"
      />
    );

    expect(getByTestId('icon-Lock')).toBeTruthy();
  });
});
