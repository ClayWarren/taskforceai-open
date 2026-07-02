import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';

describe('Card', () => {
  describe('Card', () => {
    it('renders children correctly', () => {
      render(<Card>Card Content</Card>);
      expect(screen.getByText('Card Content')).toBeTruthy();
    });

    it('applies default classes', () => {
      render(<Card data-testid="card">Test</Card>);
      const card = screen.getByTestId('card');
      expect(card.className).toContain('rounded-xl');
      expect(card.className).toContain('border');
      expect(card.className).toContain('shadow');
    });

    it('merges custom className', () => {
      render(
        <Card className="custom-class" data-testid="card">
          Test
        </Card>
      );
      const card = screen.getByTestId('card');
      expect(card.className).toContain('custom-class');
      expect(card.className).toContain('rounded-xl');
    });

    it('forwards ref', () => {
      let cardRef: HTMLDivElement | null = null;
      render(
        <Card
          ref={(el) => {
            cardRef = el;
          }}
        >
          Test
        </Card>
      );
      expect(cardRef).toBeTruthy();
      if (!cardRef) {
        throw new Error('Expected card ref to be assigned');
      }
      expect(cardRef).toBeInstanceOf(HTMLDivElement);
    });

    it('passes through HTML attributes', () => {
      render(
        <Card data-testid="card" id="my-card" aria-label="My Card">
          Test
        </Card>
      );
      const card = screen.getByTestId('card');
      expect(card.getAttribute('id')).toBe('my-card');
      expect(card.getAttribute('aria-label')).toBe('My Card');
    });
  });

  describe('CardHeader', () => {
    it('renders children correctly', () => {
      render(<CardHeader>Header Content</CardHeader>);
      expect(screen.getByText('Header Content')).toBeTruthy();
    });

    it('applies default flex layout classes', () => {
      render(<CardHeader data-testid="header">Test</CardHeader>);
      const header = screen.getByTestId('header');
      expect(header.className).toContain('flex');
      expect(header.className).toContain('flex-col');
      expect(header.className).toContain('p-6');
    });

    it('merges custom className', () => {
      render(
        <CardHeader className="extra-padding" data-testid="header">
          Test
        </CardHeader>
      );
      const header = screen.getByTestId('header');
      expect(header.className).toContain('extra-padding');
    });
  });

  describe('CardTitle', () => {
    it('renders children correctly', () => {
      render(<CardTitle>Title Text</CardTitle>);
      expect(screen.getByText('Title Text')).toBeTruthy();
    });

    it('applies font styling classes', () => {
      render(<CardTitle data-testid="title">Test</CardTitle>);
      const title = screen.getByTestId('title');
      expect(title.className).toContain('font-semibold');
      expect(title.className).toContain('tracking-tight');
    });
  });

  describe('CardDescription', () => {
    it('renders children correctly', () => {
      render(<CardDescription>Description text</CardDescription>);
      expect(screen.getByText('Description text')).toBeTruthy();
    });

    it('applies muted text styling', () => {
      render(<CardDescription data-testid="desc">Test</CardDescription>);
      const desc = screen.getByTestId('desc');
      expect(desc.className).toContain('text-sm');
      expect(desc.className).toContain('text-muted-foreground');
    });
  });

  describe('CardContent', () => {
    it('renders children correctly', () => {
      render(<CardContent>Content here</CardContent>);
      expect(screen.getByText('Content here')).toBeTruthy();
    });

    it('applies padding classes', () => {
      render(<CardContent data-testid="content">Test</CardContent>);
      const content = screen.getByTestId('content');
      expect(content.className).toContain('p-6');
      expect(content.className).toContain('pt-0');
    });
  });

  describe('CardFooter', () => {
    it('renders children correctly', () => {
      render(<CardFooter>Footer content</CardFooter>);
      expect(screen.getByText('Footer content')).toBeTruthy();
    });

    it('applies flex layout and padding', () => {
      render(<CardFooter data-testid="footer">Test</CardFooter>);
      const footer = screen.getByTestId('footer');
      expect(footer.className).toContain('flex');
      expect(footer.className).toContain('items-center');
      expect(footer.className).toContain('p-6');
      expect(footer.className).toContain('pt-0');
    });
  });

  describe('composition', () => {
    it('renders full card composition', () => {
      render(
        <Card>
          <CardHeader>
            <CardTitle>My Card</CardTitle>
            <CardDescription>Card description</CardDescription>
          </CardHeader>
          <CardContent>Main content</CardContent>
          <CardFooter>Footer</CardFooter>
        </Card>
      );

      expect(screen.getByText('My Card')).toBeTruthy();
      expect(screen.getByText('Card description')).toBeTruthy();
      expect(screen.getByText('Main content')).toBeTruthy();
      expect(screen.getByText('Footer')).toBeTruthy();
    });
  });
});
