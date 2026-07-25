import { describe, expect, it } from 'vitest';
import { dashboardHtml } from '../src/admin/dashboardHtml';

/**
 * The dashboard is a single HTML document embedded in a template literal
 * (the Docker image ships only `dist/`, and tsc doesn't copy .html).
 * That makes it structurally fragile in one specific way, which these
 * tests pin down.
 */
describe('admin dashboard payload', () => {
  it('contains no backtick or interpolation that would break the template literal', () => {
    // A stray backtick terminates the outer literal and a `${` turns the
    // page into an expression — both are compile errors that are easy to
    // introduce while editing a comment inside the payload, and easy to
    // misread as unrelated. Assert the payload never contains them.
    expect(dashboardHtml).not.toContain('`');
    expect(dashboardHtml).not.toContain('${');
  });

  it('is a complete, self-contained document', () => {
    expect(dashboardHtml.startsWith('<!doctype html>')).toBe(true);
    expect(dashboardHtml.trimEnd().endsWith('</html>')).toBe(true);
    expect(dashboardHtml).toContain('</script>');
  });

  it('makes no external requests — a strict-network box must still render it', () => {
    // No CDN scripts, stylesheets, webfonts or remote images.
    expect(dashboardHtml).not.toMatch(/<script[^>]+src=/i);
    expect(dashboardHtml).not.toMatch(/<link[^>]+stylesheet/i);
    expect(dashboardHtml).not.toMatch(/https?:\/\/(?!www\.w3\.org)/i);
  });

  it('ships no data and no token — the shell is safe to serve unauthenticated', () => {
    // The page is served before auth; it must only ever fetch data.
    expect(dashboardHtml).toContain('X-Admin-Token');
    expect(dashboardHtml).not.toMatch(/generatedAt"\s*:/);
  });

  it('resolves API calls against the mount path, not a bare relative path', () => {
    // A bare "api/x" from /admin resolves to /api/x and silently drops
    // the mount point — this regressed once already.
    expect(dashboardHtml).toContain('window.location.pathname.replace');
    expect(dashboardHtml).not.toMatch(/fetch\("api\//);
  });

  it('tells the operator that logged-out users are included', () => {
    // The whole point of the anon_* handling; if this copy disappears the
    // numbers get misread as signed-in-only.
    expect(dashboardHtml).toContain('Logged out');
    expect(dashboardHtml).toContain('anon_');
  });
});
