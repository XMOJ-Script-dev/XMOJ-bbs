/*
 *     Copyright (C) 2023-2024  XMOJ-bbs contributors
 *     This file is part of XMOJ-bbs.
 *     XMOJ-bbs is free software: you can redistribute it and/or modify
 *     it under the terms of the GNU Affero General Public License as published by
 *     the Free Software Foundation, either version 3 of the License, or
 *     (at your option) any later version.
 *
 *     XMOJ-bbs is distributed in the hope that it will be useful,
 *     but WITHOUT ANY WARRANTY; without even the implied warranty of
 *     MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *     GNU Affero General Public License for more details.
 *
 *     You should have received a copy of the GNU Affero General Public License
 *     along with XMOJ-bbs.  If not, see <https://www.gnu.org/licenses/>.
 */

export class Result {
    public Success: boolean;
    public Data: object;
    public Message: string;
    constructor(Success: boolean = false, Message: string = "Unknown error", Data: object = {}) {
        this.Success = Success;
        this.Message = Message;
        this.Data = Data;
    }
    public toString(): string {
        return JSON.stringify({
            Success: this.Success,
            Data: this.Data,
            Message: this.Message
        });
    }
}

export const ThrowErrorIfFailed = (CurrentResult: Result): Object => {
    if (CurrentResult.Success === false) {
        throw CurrentResult;
    }
    return CurrentResult.Data;
}
