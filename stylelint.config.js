// The no-raw-color policy from ARCHITECTURE §10: Primer tokens only, everywhere
// except pierre-theme.css (which carries a local stylelint-disable when it arrives).
export default {
	rules: {
		"color-no-hex": true,
		"function-disallowed-list": [
			"rgb",
			"rgba",
			"hsl",
			"hsla",
			"oklch",
			"oklab",
			"lab",
			"lch",
			"color-mix",
			"color",
		],
		"declaration-property-value-allowed-list": {
			"/color$/": ["/^var\\(--/", "transparent", "currentColor", "inherit"],
		},
	},
};
