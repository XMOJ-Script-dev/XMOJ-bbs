/*
 *     Copyright (C) 2023-2025  XMOJ-bbs contributors
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

export class Output {
    public static Debug(Message: any): void {
        // console.debug("\x1b[36m%s\x1b[0m", Message);
    }
    public static Log(Message: any): void {
        console.log("\x1b[32m%s\x1b[0m", Message);
    }
    public static Warn(Message: any): void {
        console.warn("\x1b[33m%s\x1b[0m", Message);
    }
    public static Error(Message: any): void {
        console.error("\x1b[31m%s\x1b[0m", Message);
    }
}
