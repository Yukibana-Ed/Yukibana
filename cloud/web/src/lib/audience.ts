/** Who may see a part of a person's profile, as they chose it: `app.profile_audience`
 *  (20261114100000_profile_visibility.sql), which decides; this only names the choices for a page and checks a form. */

/** The audiences, narrowest first: only the person, the people who share a course edition with them, and everyone
 *  signed in to Yukibana. The order is the order a page offers them in. */
export const AUDIENCES = ['private', 'courses', 'public'] as const;

/** One of `AUDIENCES`. */
export type Audience = (typeof AUDIENCES)[number];

/** What each audience is called on a page, as the end of "Who sees it: …". */
export const AUDIENCE_LABEL: Readonly<Record<Audience, string>> = {
    private: 'Only you',
    courses: 'People in your courses',
    public: 'Everyone signed in to Yukibana',
};

/** Returns `value` as an audience, or null when it is not one of `AUDIENCES`. */
export function audienceOf(value: string): Audience | null {
    return (AUDIENCES as readonly string[]).includes(value) ? (value as Audience) : null;
}
