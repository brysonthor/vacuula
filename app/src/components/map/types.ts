export type UseState<T> = React.Dispatch<React.SetStateAction<T>>


export type Point = [number, number]

export interface Zone {
    id: string
    name: string
    color: string
    type: 'polygon' | 'polyline'
    vertices: Point[]
    enabled: boolean
    
    // only gen4, TODO: split types by type gen3 gen4 etc
    function?: 'cleaning' | 'nogo'
}

export interface SetZone extends Zone {
    relevancy: Point
}

export interface NoGoLine {
    id: string
    name: string
    color: string
    type: 'polyline'
    vertices: Point[]
    enabled: boolean
}

export interface Offset {
    x: number
    y: number
}

export interface BasePose {
    /** Dock centre, normalised to the map grid (0..1 of width / height). */
    x: number
    y: number
    /** Dock heading in degrees (robot's base.dir). 0 = robot faces +X. */
    dir: number
}

export interface TouchState {
    distance: number
    angle: number
}

export interface VacuulaMapData {
    width: number
    height: number
    downsample: number
    map_type: "floor" | "path"
    legend: { [key: number]: string }
    rle: [number, number][]
    metadata: {
        // TODO: only gen4 has this type of metadata, gen3 has different, fix it later
        resolution: number
        origin_x: number
        origin_y: number
    }
    img_size: [number, number]
    in_maps_list: boolean
    base: [number, number, number]
}