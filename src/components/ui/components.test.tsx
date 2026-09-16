import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';
import { Input } from './Input';
import { EmptyState, ErrorState, LoadingState, NotConfiguredState } from './states';

describe('Button', () => {
  it('renders and fires onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Explore models</Button>);

    await userEvent.click(screen.getByRole('button', { name: 'Explore models' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is not clickable while loading, and announces that it is busy', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Sign in
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Sign in' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');

    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Input', () => {
  it('associates its label with the control', () => {
    render(<Input label="Email" name="email" />);
    // Queried by label: proves the label/for relationship actually exists.
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('keeps the label available to assistive tech when visually hidden', () => {
    render(<Input label="Search structures" hideLabel />);
    expect(screen.getByLabelText('Search structures')).toBeInTheDocument();
  });

  it('marks the field invalid and links the message', () => {
    render(<Input label="Password" error="Passwords must be at least 8 characters." />);

    const field = screen.getByLabelText('Password');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('at least 8 characters');
    expect(field.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
  });
});

describe('state components', () => {
  it('announces loading politely', () => {
    render(<LoadingState label="Loading model" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading model');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('renders an empty state with its action', () => {
    render(
      <EmptyState
        title="No sessions yet"
        description="Start by exploring a model."
        action={<Button>Explore</Button>}
      />,
    );

    expect(screen.getByText('No sessions yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Explore' })).toBeInTheDocument();
  });

  it('exposes errors as alerts and keeps technical detail available', () => {
    render(
      <ErrorState
        title="This model could not be loaded"
        description="The asset host returned 404."
        detail="GET /models/heart/manifest.json -> 404"
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded');
    // Detail is present but tucked into a disclosure rather than shouted.
    expect(screen.getByText(/manifest\.json/)).toBeInTheDocument();
  });

  it('names the exact variable a missing capability needs', () => {
    render(
      <NotConfiguredState
        title="No licensed spatial model is configured"
        description="VEO does not substitute generated geometry for real anatomy."
        requirement="NEXT_PUBLIC_SPATIAL_ASSET_BASE_URL"
      />,
    );

    expect(screen.getByText('NEXT_PUBLIC_SPATIAL_ASSET_BASE_URL')).toBeInTheDocument();
    // This is not an error: nothing is broken, a licence is simply absent.
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
