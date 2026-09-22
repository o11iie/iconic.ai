/**
 * The tutor fixture's model reference, split out from the fixture itself.
 *
 * The reference is needed by the client (to request the fixture) and by the
 * server (to resolve it). The fixture's graph is only needed by the server and
 * by tests. Keeping them apart means importing the reference does not pull a
 * whole graph builder into a browser bundle.
 */
export { buildTutorFixtureGraph } from './tutor-fixture';

/** Matches the fixture's `providerRef`. Reserved; never a catalogue entry. */
export const TUTOR_FIXTURE_MODEL_REF = '__veo_ai_tutor_test_fixture__';
