import { Pool } from 'mysql2/promise';
import { PlayerData } from '../types';

// Pull data about all the players in the room
export async function PullPlayerData(roomCode: string, pool: Pool): Promise<PlayerData[]> {
    const [result] = await pool.query(`SELECT player_name AS playerName, player_index AS playerIndex, player_key AS playerKey, choice AS playerChoice, score AS playerScore, secret AS playerSecret, active FROM player WHERE room_code='${roomCode}' ORDER BY player_index;`);
    return result as PlayerData[];
}