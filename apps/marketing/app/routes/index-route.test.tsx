import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'bun:test';
import React from 'react';

import { getMarketingRouterRedirects } from '../test-utils/router-mock';

let IndexRoute: any;
let HomeRoute: any;

beforeAll(async () => {
  ({ Route: IndexRoute } = await import('./index'));
  ({ Route: HomeRoute } = await import('./home'));
});

describe('Index and home routes', () => {
  it('redirects the root path to the marketing home route', () => {
    expect(() => IndexRoute.options.beforeLoad()).toThrow('Redirect to /home');
    expect(getMarketingRouterRedirects()).toEqual([{ to: '/home', statusCode: 308 }]);
  });

  it('exports home page metadata', () => {
    const head = HomeRoute.options.head();

    expect(head.meta).toContainEqual({ title: 'TaskForceAI - Multi-agent orchestration' });
    expect(head.meta).toContainEqual({
      name: 'description',
      content:
        'TaskForceAI brings multi-agent orchestration to web, desktop, mobile, CLI, SDKs, and REST APIs.',
    });
    expect(head.meta).toContainEqual({
      property: 'og:url',
      content: 'https://www.taskforceai.chat/home',
    });
    expect(head.links).toContainEqual({
      rel: 'canonical',
      href: 'https://www.taskforceai.chat/home',
    });
  });

  it('renders the marketing home page content', () => {
    const HomePage = HomeRoute.options.component as React.ComponentType;
    render(<HomePage />);

    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /TaskForceAI/ })[0]?.getAttribute('href')).toBe('/');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Multi-agent orchestration in your workflow' })
    ).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Launch web app' }).length).toBeGreaterThan(0);
    expect(document.body.textContent ?? '').not.toMatch(/GLM-5\.2|glm-5\.2|zai/i);
  });
});
