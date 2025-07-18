export const getLeaderboard = async (req, res) => {
    try {
        const allUsers = await User.find({}).sort({ ratings: -1 });
        
        // Map users to leaderboard format
        const leaderboard = allUsers.map((user, index) => ({
            rank: index + 1,
            username: user.username,
            rating: user.ratings,
            gamesPlayed: user.gamesPlayed,
            wins: user.wins,
            losses: user.losses,
            draws: user.draws,
            winRate: user.gamesPlayed > 0 ? ((user.wins / user.gamesPlayed) * 100).toFixed(2) : 0,
            lastActive: user.lastActive ? user.lastActive.toISOString() : null
        }));
        // Send the leaderboard as a response
        res.status(200).json({
            success: true,
            leaderboard
        });
        
    } catch (
        error
    ) {
        console.error("Error fetching leaderboard:", error);
        res.status(500).json({ error: "Internal server error" });
    }
}