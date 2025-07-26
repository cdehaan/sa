import { Pool } from 'mysql2/promise';
import { PlayerVerificationData, VerificationResults } from '../types';

export async function VerifyPlayer(
    playerData: PlayerVerificationData, 
    pool: Pool
): Promise<VerificationResults> {
    const results: VerificationResults = {verified: false};

    // Need a key and secret to verify
    if(playerData.playerKey === undefined || playerData.playerKey === null || playerData.playerSecret === undefined || playerData.playerSecret === null) {
        results.error = "Both player key and player secret required."
        return results;
    }

    // If the key or secret are not the right type of data, fail the test
    if(typeof playerData.playerKey !== "number" || typeof playerData.playerSecret !== "string") {
        results.error = "Player key or player secret malformed in player verification.";
        return results;
    }

    // This data exists and is the right type
    const playerKey = parseInt(playerData.playerKey.toString());
    const playerSecret = playerData.playerSecret.replace(/[^0-9a-z]/gi, '').substr(0, 20);


    let query: string;
    // If a room code wasn't sent, just verifying the player key/secret pair is enough
    if(playerData.roomCode === undefined || playerData.roomCode === null) {
        query = `SELECT count(*) FROM player WHERE player_key = ${playerKey} AND secret = '${playerSecret}';`;
    }

    // If a room code was sent, make sure it's the right type, clean it, then add it into the query
    else {
        if(typeof playerData.roomCode !== "string") {
            results.error = "Room code malformed in player verification.";
            return results;
        }
        const roomCode = playerData.roomCode.replace(/[^0-9a-z]/gi, '').substr(0, 20);
        query = `SELECT count(*) FROM player WHERE player_key = ${playerKey} AND secret = '${playerSecret}' AND room_code = '${roomCode}';`;
    }
    
    // Run the query to find the player (or not)
    const playerEntry = await pool.query(query);
    if (!playerEntry || (playerEntry[0] as any).length === 0) {
        results.error = "Player not verified to exist."
        return results;
    }

    results.verified = true;
    return results;
}