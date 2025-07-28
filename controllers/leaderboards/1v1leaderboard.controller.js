import UserModel from "../../models/User.model.js";

export const v1LeaderboardController = async(req, res) => {
        try {
            const users = await UserModel.find({})
              .sort({ ratings: -1 })  
              .select('_id email name ratings win lose');
        
            res.status(200).json({ success: true, users });
          } catch (err) {
            console.error('[GET /users/ratings]', err);
            res.status(500).json({ success: false, message: 'Internal Server Error' });
          }
};

