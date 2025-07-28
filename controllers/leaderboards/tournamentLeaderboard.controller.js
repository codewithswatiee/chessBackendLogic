import tournamentModel from "../../models/tournament.model.js";
import UserModel from "../../models/User.model.js";


// Get tournament leaderboard with user details (prioritizes latest tournament)
export const getTournamentLeaderboard = async (req, res) => {
    try {
        const tournament = await tournamentModel.findOne({ status: 'active' });
        
        if (!tournament) {
            // If no active tournament, get the most recent one
            tournament = await tournamentModel.findOne()
                .sort({ createdAt: -1 }) // Sort by creation date, latest first
                .limit(1);
        }
        
        if (!tournament) {
            return res.status(404).json({
                success: false,
                message: 'No tournaments found'
            });
        }

        // Get all user IDs from leaderboard
        const playerIds = tournament.leaderboard.map(entry => entry.player);
        
        // Fetch user details for all players
        const users = await UserModel.find({ _id: { $in: playerIds } })
            .select('_id name email avatar title createdAt currentTournamentStreak personalBestStreak')
            .lean();

        // Create a map for quick user lookup
        const userMap = {};
        users.forEach(user => {
            userMap[user._id.toString()] = user;
        });

        // Combine leaderboard data with user info
        const leaderboardWithUserInfo = tournament.leaderboard.map(entry => {
            const user = userMap[entry.player.toString()];
            return {
                rank: 0, // Will be calculated after sorting
                player: {
                    id: entry.player,
                    name: user?.name || 'Unknown Player',
                    email: user?.email || '',
                    avatar: user?.avatar || null,
                    title: user?.title || null,
                    memberSince: user?.createdAt || null,
                    currentTournamentStreak: user?.currentTournamentStreak || 0,
                    personalBestStreak: user?.personalBestStreak || 0
                },
                stats: {
                    wins: entry.wins || 0,
                    losses: entry.losses || 0,
                    draws: entry.draws || 0,
                    currentStreak: entry.currentStreak || 0,
                    points: entry.points || 0,
                    totalGames: (entry.wins || 0) + (entry.losses || 0) + (entry.draws || 0),
                    winRate: ((entry.wins || 0) / Math.max(1, (entry.wins || 0) + (entry.losses || 0) + (entry.draws || 0)) * 100).toFixed(1)
                }
            };
        });

        // Sort by wins (descending), then by currentStreak (descending), then by lowest losses
        leaderboardWithUserInfo.sort((a, b) => {
            if (b.stats.wins !== a.stats.wins) {
                return b.stats.wins - a.stats.wins;
            }
            if (b.stats.currentStreak !== a.stats.currentStreak) {
                return b.stats.currentStreak - a.stats.currentStreak;
            }
            return a.stats.losses - b.stats.losses;
        });

        // Assign ranks
        leaderboardWithUserInfo.forEach((entry, index) => {
            entry.rank = index + 1;
        });

        // Tournament summary
        const tournamentInfo = {
            id: tournament._id,
            name: tournament.name,
            status: tournament.status,
            startTime: tournament.startTime,
            endTime: tournament.endTime,
            createdAt: tournament.createdAt,
            totalParticipants: tournament.leaderboard.length,
            totalGames: tournament.leaderboard.reduce((sum, entry) => 
                sum + (entry.wins || 0) + (entry.losses || 0) + (entry.draws || 0), 0) / 2, // Divide by 2 since each game counts for 2 players
            isLatest: true
        };

        return res.status(200).json({
            success: true,
            data: {
                tournament: tournamentInfo,
                leaderboard: leaderboardWithUserInfo,
                lastUpdated: new Date()
            }
        });

    } catch (error) {
        console.error('Error fetching tournament leaderboard:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Get latest tournament leaderboard specifically
export const getLatestTournamentLeaderboard = async (req, res) => {
    try {
        // Get the most recent tournament (active first, then latest by creation date)
        let tournament = await tournamentModel.findOne({ status: 'active' })
            .sort({ createdAt: -1 });
        
        if (!tournament) {
            // If no active tournament, get the most recent one regardless of status
            tournament = await tournamentModel.findOne()
                .sort({ createdAt: -1 })
                .limit(1);
        }
        
        if (!tournament) {
            return res.status(404).json({
                success: false,
                message: 'No tournaments found'
            });
        }

        // If tournament has no leaderboard entries, return empty leaderboard
        if (!tournament.leaderboard || tournament.leaderboard.length === 0) {
            return res.status(200).json({
                success: true,
                data: {
                    tournament: {
                        id: tournament._id,
                        name: tournament.name,
                        status: tournament.status,
                        startTime: tournament.startTime,
                        endTime: tournament.endTime,
                        createdAt: tournament.createdAt,
                        totalParticipants: 0,
                        totalGames: 0,
                        isLatest: true
                    },
                    leaderboard: [],
                    lastUpdated: new Date()
                }
            });
        }

        // Get all user IDs from leaderboard
        const playerIds = tournament.leaderboard.map(entry => entry.player);
        
        // Fetch user details for all players
        const users = await UserModel.find({ _id: { $in: playerIds } })
            .select('_id name email avatar title createdAt currentTournamentStreak personalBestStreak')
            .lean();

        // Create a map for quick user lookup
        const userMap = {};
        users.forEach(user => {
            userMap[user._id.toString()] = user;
        });

        // Combine leaderboard data with user info
        const leaderboardWithUserInfo = tournament.leaderboard.map(entry => {
            const user = userMap[entry.player.toString()];
            return {
                rank: 0, // Will be calculated after sorting
                player: {
                    id: entry.player,
                    name: user?.name || 'Unknown Player',
                    email: user?.email || '',
                    avatar: user?.avatar || null,
                    title: user?.title || null,
                    memberSince: user?.createdAt || null,
                    currentTournamentStreak: user?.currentTournamentStreak || 0,
                    personalBestStreak: user?.personalBestStreak || 0
                },
                stats: {
                    wins: entry.wins || 0,
                    losses: entry.losses || 0,
                    draws: entry.draws || 0,
                    currentStreak: entry.currentStreak || 0,
                    points: entry.points || 0,
                    totalGames: (entry.wins || 0) + (entry.losses || 0) + (entry.draws || 0),
                    winRate: ((entry.wins || 0) / Math.max(1, (entry.wins || 0) + (entry.losses || 0) + (entry.draws || 0)) * 100).toFixed(1)
                }
            };
        });

        // Sort by wins (descending), then by currentStreak (descending), then by lowest losses
        leaderboardWithUserInfo.sort((a, b) => {
            if (b.stats.wins !== a.stats.wins) {
                return b.stats.wins - a.stats.wins;
            }
            if (b.stats.currentStreak !== a.stats.currentStreak) {
                return b.stats.currentStreak - a.stats.currentStreak;
            }
            return a.stats.losses - b.stats.losses;
        });

        // Assign ranks
        leaderboardWithUserInfo.forEach((entry, index) => {
            entry.rank = index + 1;
        });

        // Tournament summary
        const tournamentInfo = {
            id: tournament._id,
            name: tournament.name,
            status: tournament.status,
            startTime: tournament.startTime,
            endTime: tournament.endTime,
            createdAt: tournament.createdAt,
            totalParticipants: tournament.leaderboard.length,
            totalGames: tournament.leaderboard.reduce((sum, entry) => 
                sum + (entry.wins || 0) + (entry.losses || 0) + (entry.draws || 0), 0) / 2,
            isLatest: true
        };

        return res.status(200).json({
            success: true,
            data: {
                tournament: tournamentInfo,
                leaderboard: leaderboardWithUserInfo,
                lastUpdated: new Date()
            }
        });

    } catch (error) {
        console.error('Error fetching latest tournament leaderboard:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Get current user's position in latest tournament leaderboard
export const getUserLatestTournamentPosition = async (req, res) => {
    try {
        const { userId } = req.params;

        // Get the latest tournament (active first, then most recent)
        let tournament = await tournamentModel.findOne({ status: 'active' })
            .sort({ createdAt: -1 });
        
        if (!tournament) {
            tournament = await tournamentModel.findOne()
                .sort({ createdAt: -1 })
                .limit(1);
        }

        if (!tournament) {
            return res.status(404).json({
                success: false,
                message: 'No tournaments found'
            });
        }

        // Find user in leaderboard
        const userEntry = tournament.leaderboard.find(entry => 
            entry.player.toString() === userId
        );

        if (!userEntry) {
            return res.status(404).json({
                success: false,
                message: 'User not found in latest tournament leaderboard',
                tournament: {
                    id: tournament._id,
                    name: tournament.name,
                    status: tournament.status
                }
            });
        }

        // Get user details
        const user = await UserModel.findById(userId)
            .select('name email avatar title currentTournamentStreak personalBestStreak')
            .lean();

        // Calculate rank
        const sortedLeaderboard = tournament.leaderboard
            .map(entry => ({
                player: entry.player,
                wins: entry.wins || 0,
                losses: entry.losses || 0,
                currentStreak: entry.currentStreak || 0
            }))
            .sort((a, b) => {
                if (b.wins !== a.wins) return b.wins - a.wins;
                if (b.currentStreak !== a.currentStreak) return b.currentStreak - a.currentStreak;
                return a.losses - b.losses;
            });

        const userRank = sortedLeaderboard.findIndex(entry => 
            entry.player.toString() === userId
        ) + 1;

        const userStats = {
            rank: userRank,
            totalParticipants: tournament.leaderboard.length,
            player: {
                id: userId,
                name: user?.name || 'Unknown Player',
                avatar: user?.avatar || null,
                title: user?.title || null,
                currentTournamentStreak: user?.currentTournamentStreak || 0,
                personalBestStreak: user?.personalBestStreak || 0
            },
            stats: {
                wins: userEntry.wins || 0,
                losses: userEntry.losses || 0,
                draws: userEntry.draws || 0,
                currentStreak: userEntry.currentStreak || 0,
                points: userEntry.points || 0,
                totalGames: (userEntry.wins || 0) + (userEntry.losses || 0) + (userEntry.draws || 0),
                winRate: ((userEntry.wins || 0) / Math.max(1, (userEntry.wins || 0) + (userEntry.losses || 0) + (userEntry.draws || 0)) * 100).toFixed(1)
            }
        };

        return res.status(200).json({
            success: true,
            data: {
                tournament: {
                    id: tournament._id,
                    name: tournament.name,
                    status: tournament.status,
                    isLatest: true
                },
                userPosition: userStats
            }
        });

    } catch (error) {
        console.error('Error fetching user latest tournament position:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Get tournament history (past tournaments)
export const getTournamentHistory = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const skip = (page - 1) * limit;

        const tournaments = await tournamentModel.find({ 
            status: { $in: ['completed', 'finished'] } 
        })
        .sort({ createdAt: -1 }) // Latest first
        .skip(skip)
        .limit(parseInt(limit))
        .select('_id name startTime endTime createdAt leaderboard')
        .lean();

        const tournamentsWithSummary = await Promise.all(
            tournaments.map(async (tournament) => {
                // Get top 3 players
                const sortedLeaderboard = tournament.leaderboard
                    .sort((a, b) => {
                        if (b.wins !== a.wins) return (b.wins || 0) - (a.wins || 0);
                        if (b.currentStreak !== a.currentStreak) return (b.currentStreak || 0) - (a.currentStreak || 0);
                        return (a.losses || 0) - (b.losses || 0);
                    })
                    .slice(0, 3);

                // Get user details for top 3
                const topPlayerIds = sortedLeaderboard.map(entry => entry.player);
                const topPlayers = await UserModel.find({ _id: { $in: topPlayerIds } })
                    .select('_id name avatar title')
                    .lean();

                const playerMap = {};
                topPlayers.forEach(player => {
                    playerMap[player._id.toString()] = player;
                });

                const topThree = sortedLeaderboard.map((entry, index) => {
                    const player = playerMap[entry.player.toString()];
                    return {
                        rank: index + 1,
                        player: {
                            id: entry.player,
                            name: player?.name || 'Unknown Player',
                            avatar: player?.avatar || null,
                            title: player?.title || null
                        },
                        stats: {
                            wins: entry.wins || 0,
                            losses: entry.losses || 0,
                            draws: entry.draws || 0,
                            currentStreak: entry.currentStreak || 0
                        }
                    };
                });

                return {
                    id: tournament._id,
                    name: tournament.name,
                    startTime: tournament.startTime,
                    endTime: tournament.endTime,
                    totalParticipants: tournament.leaderboard.length,
                    topThree
                };
            })
        );

        const totalTournaments = await tournamentModel.countDocuments({ 
            status: { $in: ['completed', 'finished'] } 
        });

        return res.status(200).json({
            success: true,
            data: {
                tournaments: tournamentsWithSummary,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalTournaments / limit),
                    totalTournaments,
                    hasNextPage: page * limit < totalTournaments,
                    hasPrevPage: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Error fetching tournament history:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};