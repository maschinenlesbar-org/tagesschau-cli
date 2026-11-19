// Test helpers of this server's own tests and the adapters of the conformance tests: a mock
// upstream on the Tagesschau API (the client's fixtures: live answers recorded on 2026-11-19, cut
// to the fields the tools read: the homepage, the sport feed, Berlin's feed, a search, the channels
// and one article), and the client's transport helpers. The generic harness (a connection, a
// config, a log recorder, the HTTP server) is harness.ts.

export * from "@maschinenlesbar.org/tagesschau-client/test/helpers";
export * from "@maschinenlesbar.org/tagesschau-client/test/fixtures";
