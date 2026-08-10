<script lang="ts">
    /**
     * Inline SVG per icon, tree-shaken, so nothing loads a glyph set over the network and every
     * icon lands on the grid. `size` names a token rather than a pixel value.
     */
    type IconName =
        | "home"
        | "terminal"
        | "settings"
        | "add"
        | "play"
        | "stop"
        | "restart"
        | "update"
        | "down"
        | "delete"
        | "edit"
        | "save"
        | "close"
        | "search"
        | "chevron-down"
        | "chevron-up"
        | "chevron-right"
        | "arrow-up"
        | "arrow-down"
        | "arrow-left"
        | "arrow-right"
        | "undo"
        | "redo"
        | "indent"
        | "outdent"
        | "external"
        | "warning"
        | "check"
        | "shell"
        | "host"
        | "logout"
        | "more";

    const PATHS: Record<IconName, string> = {
        home: "M4 20v-9l8-6 8 6v9h-6v-6h-4v6H4Z",
        terminal: "M3 4h18v16H3V4Zm3 4 3 3-3 3m5 3h6",
        settings:
            "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3.5h-4l-.3 2.6c-.6.2-1.2.6-1.7 1l-2.4-1-2 3.4L4.6 11a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1 .7 1.7 1l.3 2.6h4l.3-2.6c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4-2-1.6Z",
        add: "M12 5v14M5 12h14",
        play: "M8 5l11 7-11 7V5Z",
        stop: "M6 6h12v12H6z",
        restart: "M4 12a8 8 0 1 0 3-6.2M4 4v5h5",
        update: "M12 3v12m0 0 4-4m-4 4-4-4M5 19h14",
        down: "M12 21V9m0 12 4-4m-4 4-4-4M5 5h14",
        delete: "M6 7h12l-1 13H7L6 7Zm3-3h6v3H9V4Zm1 7v6m4-6v6",
        edit: "M4 20h4L20 8l-4-4L4 16v4Z",
        save: "M5 4h11l4 4v12H5V4Zm3 0v6h8V4M8 20v-5h8v5",
        close: "M6 6l12 12M18 6 6 18",
        search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm4.6-.4L20 21.5",
        "chevron-down": "M6 9l6 6 6-6",
        "chevron-up": "M6 15l6-6 6 6",
        "chevron-right": "M9 6l6 6-6 6",
        "arrow-up": "M12 20V4m0 0-6 6m6-6 6 6",
        "arrow-down": "M12 4v16m0 0 6-6m-6 6-6-6",
        "arrow-left": "M20 12H4m0 0 6-6m-6 6 6 6",
        "arrow-right": "M4 12h16m0 0-6-6m6 6-6 6",
        undo: "M4 9h9a6 6 0 0 1 0 12h-6M4 9l4-4M4 9l4 4",
        redo: "M20 9h-9a6 6 0 0 0 0 12h6M20 9l-4-4M20 9l-4 4",
        indent: "M4 5h16M4 19h16M11 9h9M11 15h9M4 9l3 3-3 3",
        outdent: "M4 5h16M4 19h16M11 9h9M11 15h9M7 9l-3 3 3 3",
        external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
        warning: "M12 3 2 20h20L12 3Zm0 6v6m0 3v.5",
        check: "M4 12l5 5L20 6",
        shell: "M4 5h16v14H4V5Zm3 5 3 2-3 2m5 2h5",
        host: "M4 6h16v5H4V6Zm0 7h16v5H4v-5Zm3-4.5v.01M7 15.5v.01",
        logout: "M15 4h5v16h-5M13 12H3m10 0-4-4m4 4-4 4",
        more: "M12 6.5v.01M12 12v.01M12 17.5v.01",
    };

    interface Props {
        name: IconName;
        size?: "sm" | "md" | "lg";
        title?: string;
    }

    const { name, size = "md", title }: Props = $props();
</script>

<svg
    class="icon size-{size}"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    role={title === undefined ? "presentation" : "img"}
    aria-hidden={title === undefined ? "true" : undefined}
    aria-label={title}
>
    {#if title !== undefined}<title>{title}</title>{/if}
    <path d={PATHS[name]} />
</svg>

<style>
    .icon {
        flex: none;
    }

    .size-sm {
        inline-size: var(--size-icon-sm);
        block-size: var(--size-icon-sm);
    }

    .size-md {
        inline-size: var(--size-icon-md);
        block-size: var(--size-icon-md);
    }

    .size-lg {
        inline-size: var(--size-icon-lg);
        block-size: var(--size-icon-lg);
    }
</style>
