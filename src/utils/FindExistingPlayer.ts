import { Pool } from 'mysql2/promise';

// Return an existing player with a given key and secret, if they exist
export async function FindExistingPlayer(
    playerKey: number, 
    playerSecret: string, 
    pool: Pool
): Promise<any> {
    return await pool.query(`SELECT * from player WHERE player_key = ${playerKey} AND secret ='${playerSecret}'`);
}