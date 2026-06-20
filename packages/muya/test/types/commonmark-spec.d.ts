declare module 'commonmark-spec' {
    interface ICommonMarkSpecTest {
        markdown: string;
        html: string;
        section: string;
    }

    const cms: { tests: ICommonMarkSpecTest[] };
    export default cms;
}
