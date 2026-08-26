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
