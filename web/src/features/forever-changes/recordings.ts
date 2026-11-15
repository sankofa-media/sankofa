// The official recordings Forever Changes plays in the museum's docked
// player. Only official distribution is accepted: YouTube's auto-generated
// "Topic" channels (the labels' own feed), label channels, Vevo, or the
// artist's own channel. Each id was checked on 2026-11-15 with YouTube's
// oEmbed (https://www.youtube.com/oembed?url=…&format=json → author_name,
// author_url) and against the video's own description ("Provided to YouTube
// by …", the album). The album tracks are the 2015 remaster of the album
// itself, all from the same channel.
// Kept beside the code, not in feature.yaml, so the editor's text never
// conflicts with it.

export interface Official {
  youtube: string;
  /** The title as the upload names it. */
  title: string;
  artist: string;
  year: number;
  /** oEmbed author_name. */
  channel: string;
  /** oEmbed author_url's channel id or handle. */
  channelId: string;
  /** How it was verified. */
  verified: string;
}

const LOVE = { artist: 'Love', year: 1967, channel: 'Love - Topic', channelId: 'UCvRWnqwD2m5JppTUouPG1KA' };
const LOVE_CHECK = 'oEmbed author_name "Love - Topic" (auto-generated official distribution); description: "Provided to YouTube by Rhino/Elektra", album Forever Changes, ℗ 1967 Elektra/Asylum Records';

const track = (youtube: string, title: string): Official => ({ ...LOVE, youtube, title: `${title} (2015 Remaster)`, verified: LOVE_CHECK });

/** The album, by song chapter. */
export const SONGS: Record<string, Official> = {
  'alone-again-or': track('cPbNpIG8x_s', 'Alone Again Or'),
  'a-house-is-not-a-motel': track('H3xzHYz6L5w', 'A House Is Not a Motel'),
  andmoreagain: track('zfis7-VEYMs', 'Andmoreagain'),
  'the-daily-planet': track('wgUoIBJtMLI', 'The Daily Planet'),
  'old-man': track('I91tC_o7FS4', 'Old Man'),
  'the-red-telephone': track('m_j0qicK9mc', 'The Red Telephone'),
  'between-clark-and-hilldale': track('hwnyoH5DpNE', 'Maybe the People Would Be the Times or Between Clark and Hilldale'),
  'live-and-let-live': track('O2T-dz1k9bI', 'Live and Let Live'),
  'the-good-humor-man': track('NXtWtf6Mmcw', 'The Good Humor Man He Sees Everything Like This'),
  'bummer-in-the-summer': track('WC19_-riICA', 'Bummer in the Summer'),
  'you-set-the-scene': track('-N9kGKFIAQk', 'You Set the Scene'),
};

/** Later versions the echoes chapter names. */
export const ECHOES: Official[] = [
  {
    youtube: 'QXaP1ssixCc',
    title: 'Alone Again Or (2024 Remaster)',
    artist: 'UFO',
    year: 1977,
    channel: 'UFO - Topic',
    channelId: 'UCo9zj2fOXyQJO0mAhyGMOkw',
    verified: 'oEmbed author_name "UFO - Topic" (auto-generated); description: "Provided to YouTube by Reservoir Media Management", album Lights Out, ℗ 2024 Chrysalis Records',
  },
  {
    youtube: 'VOzHnbwZIUo',
    title: 'Alone Again Or',
    artist: 'The Damned',
    year: 1987,
    channel: 'The Damned - Topic',
    channelId: 'UCuxl25M6Si9Yoel_qsMB3Fw',
    verified: 'oEmbed author_name "The Damned - Topic" (auto-generated); description: "Provided to YouTube by Universal Music Group", album The Light at the End of the Tunnel, ℗ 1986 Universal-Island Records',
  },
  {
    youtube: 'RZkkbFUB-x0',
    title: 'Alone Again Or (Official Audio)',
    artist: 'Calexico',
    year: 2003,
    channel: 'Calexico',
    channelId: '@CasaDeCalexico',
    verified: 'oEmbed author_name "Calexico", author_url youtube.com/@CasaDeCalexico (the band\'s own channel); from the Feast of Wire 20th Anniversary Deluxe Edition',
  },
];

export const OFFICIAL_CHANNELS = /^(.+ - Topic|Rhino|Elektra Records|Warner Records|.+VEVO|Calexico)$/;
