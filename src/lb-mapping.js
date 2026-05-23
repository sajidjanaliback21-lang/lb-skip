/**
 * Dedicated configuration file for IPTV Playlist URL Rewriting.
 * Easily update the mappings or the default main server IP for node balancing.
 */

export const DEFAULT_MAIN_SERVER_IP = "45.142.0.21";

export const INITIAL_MAPPINGS = {
  "103.169.98.238": "lb1.hdsj.store",
  "45.148.147.213": "lb2.hdsj.store",
  "45.88.0.176": "lb3.hdsj.store",
  "181.215.178.154": "lb4.hdsj.store",
  "45.159.92.158": "lb5.hdsj.store",
  "181.215.178.23": "lb6.hdsj.store"
};
