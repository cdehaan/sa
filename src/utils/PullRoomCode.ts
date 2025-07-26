import { Pool } from 'mysql2/promise';

// Find the player's room code with the player's key and secret
export async function PullRoomCode(playerKey: number, playerSecret: string, pool: Pool): Promise<string | null> {
    const [result] = await pool.query(`SELECT room_code as roomCode FROM player WHERE player_key = ${playerKey} AND secret = '${playerSecret}';`);
    if (!result)               { return null; }
    if ((result as any).length == 0) { return null; }
    return (result as any)[0].roomCode;
}