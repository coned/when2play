/**
 * Shared slash command definitions.
 * Used by both the Worker's /register endpoint and the local registration script.
 * Edit command names/descriptions here — both places stay in sync automatically.
 */
export const COMMANDS = [
	{
		name: 'conequest',
		description: 'Gaming session polls',
		options: [
			{
				type: 1, // SUB_COMMAND
				name: 'propose',
				description: 'Propose a gaming session and let people vote on time slots',
			},
			{
				type: 1,
				name: 'close',
				description: 'Close your currently active poll early',
			},
			{
				type: 1,
				name: 'history',
				description: 'Show recent gaming polls',
				options: [
					{
						type: 4, // INTEGER
						name: 'count',
						description: 'Number of polls to show (default 5, max 10)',
						required: false,
						min_value: 1,
						max_value: 10,
					},
				],
			},
			{
				type: 1,
				name: 'stats',
				description: 'Show gaming analytics (top games, most active players)',
			},
		],
	},
];
