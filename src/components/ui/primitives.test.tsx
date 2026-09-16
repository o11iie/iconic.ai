import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IconButton } from './IconButton';
import { Tooltip } from './Tooltip';
import { Avatar } from './Avatar';
import { Search } from './Search';
import { Tabs, TabPanel, Segmented } from './Tabs';
import { Menu } from './Menu';
import { Modal, Drawer } from './Overlay';

describe('IconButton', () => {
  it('always exposes an accessible name, since the glyph carries no text', () => {
    render(<IconButton icon="close" label="Close panel" />);
    expect(screen.getByRole('button', { name: 'Close panel' })).toBeInTheDocument();
  });

  it('reports toggle state through aria-pressed', () => {
    render(<IconButton icon="layers" label="Layers" active />);
    expect(screen.getByRole('button', { name: 'Layers' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Tooltip', () => {
  it('opens on keyboard focus, not only on hover', async () => {
    render(
      <Tooltip content="Frame the whole model">
        <button type="button">Reset</button>
      </Tooltip>,
    );

    expect(screen.queryByRole('tooltip')).toBeNull();
    await userEvent.tab();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Frame the whole model');
  });
});

describe('Avatar', () => {
  it('derives initials from a name, then an email', () => {
    const { rerender } = render(<Avatar name="Ada Lovelace" />);
    expect(screen.getByText('AL')).toBeInTheDocument();

    rerender(<Avatar name={null} email="grace.hopper@navy.mil" />);
    expect(screen.getByText('GH')).toBeInTheDocument();
  });

  it('never renders an empty mark', () => {
    render(<Avatar />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });
});

describe('Search', () => {
  it('keeps a real label for assistive tech while hiding it visually', () => {
    render(<Search label="Search structures" />);
    expect(screen.getByLabelText('Search structures')).toBeInTheDocument();
  });

  it('offers a clear control only when there is something to clear', async () => {
    const onClear = vi.fn();
    const { rerender } = render(<Search value="" onChange={() => {}} onClear={onClear} />);
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();

    rerender(<Search value="heart" onChange={() => {}} onClear={onClear} />);
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});

function TabsHarness() {
  const [value, setValue] = useState('models');
  return (
    <>
      <Tabs
        label="Library"
        value={value}
        onChange={setValue}
        items={[
          { id: 'models', label: 'Models' },
          { id: 'notes', label: 'Notes' },
          { id: 'cards', label: 'Cards' },
        ]}
      />
      <TabPanel id="models" active={value === 'models'}>
        Models panel
      </TabPanel>
      <TabPanel id="notes" active={value === 'notes'}>
        Notes panel
      </TabPanel>
      <TabPanel id="cards" active={value === 'cards'}>
        Cards panel
      </TabPanel>
    </>
  );
}

describe('Tabs', () => {
  it('uses a roving tabindex so only the selected tab is in the tab order', () => {
    render(<TabsHarness />);
    expect(screen.getByRole('tab', { name: 'Models' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('tabindex', '-1');
  });

  it('moves between tabs with arrow keys and wraps around', async () => {
    render(<TabsHarness />);
    const first = screen.getByRole('tab', { name: 'Models' });
    first.focus();

    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Cards' })).toHaveAttribute('aria-selected', 'true');
  });

  it('links each panel back to its tab', async () => {
    render(<TabsHarness />);
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', 'tab-models');
    expect(panel).toHaveTextContent('Models panel');
  });
});

describe('Segmented', () => {
  it('uses radiogroup semantics because it selects a value, not a panel', async () => {
    function Harness() {
      const [value, setValue] = useState('a');
      return (
        <Segmented
          label="Level"
          value={value}
          onChange={setValue}
          options={[
            { value: 'a', label: 'Beginner' },
            { value: 'b', label: 'Advanced' },
          ]}
        />
      );
    }
    render(<Harness />);
    expect(screen.getByRole('radiogroup', { name: 'Level' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Advanced' }));
    expect(screen.getByRole('radio', { name: 'Advanced' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Menu', () => {
  it('follows the menu-button pattern and closes on Escape', async () => {
    const onSelect = vi.fn();
    render(
      <Menu
        label="Account menu"
        items={[{ id: 'settings', label: 'Settings', onSelect }]}
        trigger={() => <span>Account</span>}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Account menu' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByRole('menuitem', { name: 'Settings' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menuitem')).toBeNull());
  });

  it('invokes the selected item and closes', async () => {
    const onSelect = vi.fn();
    render(
      <Menu
        label="Account menu"
        items={[{ id: 'signout', label: 'Sign out', onSelect }]}
        trigger={() => <span>Account</span>}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});

describe('Modal', () => {
  it('is a labelled modal dialog', async () => {
    render(
      <Modal open onClose={() => {}} title="Delete your account?">
        <p>Body</p>
      </Modal>,
    );

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Delete your account?');
  });

  it('closes on Escape, so it is never a keyboard trap', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Delete your account?">
        <button type="button">Confirm</button>
      </Modal>,
    );

    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('moves focus inside on open', async () => {
    render(
      <Modal open onClose={() => {}} title="Dialog">
        <button type="button">First action</button>
      </Modal>,
    );

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={() => {}} title="Dialog">
        <p>Body</p>
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Drawer', () => {
  it('is a labelled modal dialog and closes on Escape', async () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} title="Structure details" side="bottom">
        <p>Panel body</p>
      </Drawer>,
    );

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName('Structure details');

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
