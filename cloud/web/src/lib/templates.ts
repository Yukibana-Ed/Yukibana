/** The template repositories the project page recommends to a teacher
 *  starting a course repository, each a GitHub template whose workflow
 *  publishes by the repository's link, with GitHub's OIDC token
 *  (docs/cloud/github.md). The page links to GitHub's own "Use this
 *  template" page for each; nothing here creates repositories, so the
 *  GitHub App needs no permission to.
 *
 *  A list in code rather than configuration: which templates exist is the
 *  same for every environment, and adding one is a reviewed change. A
 *  template belongs here only once its workflow has `permissions: id-token:
 *  write` and runs the Action without a token, or teachers would start from
 *  a repository that cannot publish.
 */

/** One recommended template. */
export interface Template {
    /** What the page calls it, such as "Scala 3 with sbt". */
    readonly name: string;
    /** The template repository on GitHub, as `owner/name`. */
    readonly repository: string;
    /** One sentence on what a repository made from it starts with. */
    readonly description: string;
}

/** The recommended templates, in the order the page shows them. */
export const TEMPLATES: readonly Template[] = [
    {
        name: 'Scala 3 with sbt',
        repository: 'Yukibana-Ed/scala-project-template',
        description: 'An sbt project with one Scala file, an assignment page and the publishing workflow.',
    },
];

/** GitHub's page that makes a new repository from `template`. */
export function useTemplateUrl(template: Template): string {
    return `https://github.com/${template.repository}/generate`;
}
