import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';

describe('App', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the Cane heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Cane' })).toBeTruthy();
  });
});
